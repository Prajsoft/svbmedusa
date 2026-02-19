import {
  applyReturnTransition,
  emitReturnEvent,
  getOrder,
  getReturnIntentOrThrow,
  normalizeReturnId,
  persistReturnIntent,
  requireIdempotencyKey,
  ReturnWorkflowError,
} from "./shared"

export type ReturnApproveWorkflowInput = {
  order_id: string
  return_id?: string
  idempotency_key: string
  actor_id?: string
  reason?: string
}

export type ReturnApproveWorkflowResult = {
  order_id: string
  return_id: string
  from_state: string
  to_state: string
  changed: boolean
}

export async function returnApproveWorkflow(
  scope: { resolve: (key: string) => any },
  input: ReturnApproveWorkflowInput
): Promise<ReturnApproveWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new ReturnWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const returnId = normalizeReturnId(input.return_id)
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const order = await getOrder(scope, orderId)
  const intent = getReturnIntentOrThrow(order, returnId)

  const transition = applyReturnTransition(intent, {
    action: "return_approve",
    to_state: "approved",
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

  await persistReturnIntent(scope, order, transition.intent)
  await emitReturnEvent(scope, "return.approved", {
    order_id: order.id,
    return_id: returnId,
    actor_id: input.actor_id,
    reason: input.reason?.trim() || undefined,
  })

  return {
    order_id: order.id,
    return_id: returnId,
    from_state: transition.from_state,
    to_state: transition.to_state,
    changed: true,
  }
}
