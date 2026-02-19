import { recordCodRefundWorkflow } from "../cod/admin-operations"
import { requestPrepaidRefundWorkflowStub } from "./prepaid-refund-stub"
import {
  applyInventoryMovementForReturn,
  applyReturnTransition,
  emitReturnEvent,
  getOrder,
  getReturnIntentOrThrow,
  isCodOrder,
  markAsRefunded,
  normalizeReturnId,
  persistReturnIntent,
  requireIdempotencyKey,
  resolveRefundAmount,
  ReturnWorkflowError,
  withRefund,
} from "./shared"

export type ReturnQcPassWorkflowInput = {
  order_id: string
  return_id?: string
  idempotency_key: string
  actor_id?: string
  reason?: string
  refund_amount?: number
  refund_reason?: string
}

export type ReturnQcPassWorkflowResult = {
  order_id: string
  return_id: string
  from_state: string
  to_state: string
  changed: boolean
}

export async function returnQcPassWorkflow(
  scope: { resolve: (key: string) => any },
  input: ReturnQcPassWorkflowInput
): Promise<ReturnQcPassWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new ReturnWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const returnId = normalizeReturnId(input.return_id)
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const order = await getOrder(scope, orderId)
  const intent = getReturnIntentOrThrow(order, returnId)

  const transition = applyReturnTransition(intent, {
    action: "return_qc_pass",
    to_state: "qc_passed",
    idempotency_key: idempotencyKey,
    actor_id: input.actor_id,
    reason: input.reason,
  })

  if (!transition.changed) {
    return {
      order_id: order.id,
      return_id: returnId,
      from_state: transition.from_state,
      to_state: transition.to_state,
      changed: false,
    }
  }

  const inventoryMovement = await applyInventoryMovementForReturn(
    scope,
    transition.intent,
    "qc_hold_to_sellable"
  )

  const refundAmount = resolveRefundAmount(
    order,
    inventoryMovement.intent,
    input.refund_amount
  )
  const refundReason =
    input.refund_reason?.trim() || input.reason?.trim() || `Return ${returnId} QC passed`

  let updatedIntent = inventoryMovement.intent
  const codOrder = isCodOrder(order)

  if (codOrder) {
    const codRefund = await recordCodRefundWorkflow(scope, {
      order_id: order.id,
      amount: refundAmount,
      reason: refundReason,
      actor_id: input.actor_id,
    })

    updatedIntent = withRefund(updatedIntent, {
      mode: "cod",
      status: "recorded",
      amount: refundAmount,
      reason: refundReason,
      reference: codRefund.payment_id,
      updated_at: new Date().toISOString(),
    })
    updatedIntent = markAsRefunded(updatedIntent, input.actor_id)
  } else {
    const prepaidRefund = await requestPrepaidRefundWorkflowStub(scope, {
      order_id: order.id,
      return_id: returnId,
      amount: refundAmount,
      reason: refundReason,
      actor_id: input.actor_id,
    })

    updatedIntent = withRefund(updatedIntent, {
      mode: "prepaid",
      status: "requested",
      amount: refundAmount,
      reason: refundReason,
      reference: prepaidRefund.reference,
      updated_at: new Date().toISOString(),
    })
  }

  await persistReturnIntent(scope, order, updatedIntent)
  await emitReturnEvent(scope, "return.qc_passed", {
    order_id: order.id,
    return_id: returnId,
    actor_id: input.actor_id,
    reason: input.reason?.trim() || undefined,
    inventory_move: inventoryMovement.movement,
    refund_mode: codOrder ? "cod" : "prepaid",
    refund_state: updatedIntent.refund?.status,
  })

  return {
    order_id: order.id,
    return_id: returnId,
    from_state: transition.from_state,
    to_state: updatedIntent.state,
    changed: true,
  }
}
