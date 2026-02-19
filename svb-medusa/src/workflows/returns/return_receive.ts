import {
  applyInventoryMovementForReturn,
  applyReturnTransition,
  emitReturnEvent,
  getOrder,
  getReturnIntentOrThrow,
  normalizeReturnId,
  persistReturnIntent,
  requireIdempotencyKey,
  ReturnWorkflowError,
} from "./shared"

export type ReturnReceiveWorkflowInput = {
  order_id: string
  return_id?: string
  idempotency_key: string
  actor_id?: string
  reason?: string
}

export type ReturnReceiveWorkflowResult = {
  order_id: string
  return_id: string
  from_state: string
  to_state: string
  changed: boolean
}

export async function returnReceiveWorkflow(
  scope: { resolve: (key: string) => any },
  input: ReturnReceiveWorkflowInput
): Promise<ReturnReceiveWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new ReturnWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const returnId = normalizeReturnId(input.return_id)
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const order = await getOrder(scope, orderId)
  const intent = getReturnIntentOrThrow(order, returnId)

  const transition = applyReturnTransition(intent, {
    action: "return_receive",
    to_state: "received",
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
    "to_qc_hold"
  )

  await persistReturnIntent(scope, order, inventoryMovement.intent)
  await emitReturnEvent(scope, "return.received", {
    order_id: order.id,
    return_id: returnId,
    actor_id: input.actor_id,
    reason: input.reason?.trim() || undefined,
    inventory_move: inventoryMovement.movement,
  })

  return {
    order_id: order.id,
    return_id: returnId,
    from_state: transition.from_state,
    to_state: transition.to_state,
    changed: true,
  }
}
