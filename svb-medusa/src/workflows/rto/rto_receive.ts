import {
  applyInventoryMovementForRto,
  applyRtoTransition,
  emitRtoEvent,
  getOrder,
  getRtoIntentOrThrow,
  normalizeRtoId,
  persistRtoIntent,
  requireIdempotencyKey,
  RtoWorkflowError,
} from "./shared"

export type RtoReceiveWorkflowInput = {
  order_id: string
  rto_id?: string
  idempotency_key: string
  actor_id?: string
  reason?: string
}

export type RtoReceiveWorkflowResult = {
  order_id: string
  rto_id: string
  from_state: string
  to_state: string
  changed: boolean
}

export async function rtoReceiveWorkflow(
  scope: { resolve: (key: string) => any },
  input: RtoReceiveWorkflowInput
): Promise<RtoReceiveWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new RtoWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const rtoId = normalizeRtoId(input.rto_id)
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const order = await getOrder(scope, orderId)
  const intent = getRtoIntentOrThrow(order, rtoId)

  const transition = applyRtoTransition(intent, {
    action: "rto_receive",
    to_state: "received",
    idempotency_key: idempotencyKey,
    actor_id: input.actor_id,
    reason: input.reason,
  })

  if (!transition.changed) {
    return {
      order_id: order.id,
      rto_id: rtoId,
      from_state: transition.from_state,
      to_state: transition.to_state,
      changed: false,
    }
  }

  const inventoryMovement = await applyInventoryMovementForRto(
    scope,
    transition.intent,
    "to_qc_hold"
  )

  await persistRtoIntent(scope, order, inventoryMovement.intent)
  await emitRtoEvent(scope, "rto.received", {
    order_id: order.id,
    rto_id: rtoId,
    actor_id: input.actor_id,
    reason: input.reason?.trim() || undefined,
    inventory_move: inventoryMovement.movement,
  })

  return {
    order_id: order.id,
    rto_id: rtoId,
    from_state: transition.from_state,
    to_state: transition.to_state,
    changed: true,
  }
}
