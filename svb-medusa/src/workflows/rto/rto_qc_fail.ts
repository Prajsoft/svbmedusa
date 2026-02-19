import {
  applyInventoryMovementForRto,
  applyRtoTransition,
  assertCodNotCapturedForRto,
  emitPrepaidRefundStubForRto,
  emitRtoEvent,
  getOrder,
  getRtoIntentOrThrow,
  isPrepaidOrder,
  normalizeRtoId,
  persistRtoIntent,
  requireIdempotencyKey,
  RtoWorkflowError,
} from "./shared"

export type RtoQcFailWorkflowInput = {
  order_id: string
  rto_id?: string
  idempotency_key: string
  actor_id?: string
  reason?: string
}

export type RtoQcFailWorkflowResult = {
  order_id: string
  rto_id: string
  from_state: string
  to_state: string
  changed: boolean
}

export async function rtoQcFailWorkflow(
  scope: { resolve: (key: string) => any },
  input: RtoQcFailWorkflowInput
): Promise<RtoQcFailWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new RtoWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const rtoId = normalizeRtoId(input.rto_id)
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const order = await getOrder(scope, orderId)
  assertCodNotCapturedForRto(order)
  const intent = getRtoIntentOrThrow(order, rtoId)

  const transition = applyRtoTransition(intent, {
    action: "rto_qc_fail",
    to_state: "qc_failed",
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
    "qc_hold_to_damage"
  )

  await persistRtoIntent(scope, order, inventoryMovement.intent)
  await emitRtoEvent(scope, "rto.qc_failed", {
    order_id: order.id,
    rto_id: rtoId,
    actor_id: input.actor_id,
    reason: input.reason?.trim() || undefined,
    inventory_move: inventoryMovement.movement,
  })

  if (isPrepaidOrder(order)) {
    await emitPrepaidRefundStubForRto(scope, {
      order_id: order.id,
      rto_id: rtoId,
      stage: "qc_failed",
    })
  }

  return {
    order_id: order.id,
    rto_id: rtoId,
    from_state: transition.from_state,
    to_state: transition.to_state,
    changed: true,
  }
}
