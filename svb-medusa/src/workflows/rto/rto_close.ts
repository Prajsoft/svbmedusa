import {
  applyRtoTransition,
  emitRtoEvent,
  getOrder,
  getRtoIntentOrThrow,
  normalizeRtoId,
  persistRtoIntent,
  requireIdempotencyKey,
  RtoWorkflowError,
} from "./shared"

export type RtoCloseWorkflowInput = {
  order_id: string
  rto_id?: string
  idempotency_key: string
  actor_id?: string
  reason?: string
}

export type RtoCloseWorkflowResult = {
  order_id: string
  rto_id: string
  from_state: string
  to_state: string
  changed: boolean
}

export async function rtoCloseWorkflow(
  scope: { resolve: (key: string) => any },
  input: RtoCloseWorkflowInput
): Promise<RtoCloseWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new RtoWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const rtoId = normalizeRtoId(input.rto_id)
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const order = await getOrder(scope, orderId)
  const intent = getRtoIntentOrThrow(order, rtoId)
  const replayEntry = intent.idempotency_log?.[idempotencyKey]

  if (replayEntry?.action === "rto_close") {
    return {
      order_id: order.id,
      rto_id: rtoId,
      from_state: intent.state,
      to_state: intent.state,
      changed: false,
    }
  }

  if (intent.state !== "qc_passed" && intent.state !== "qc_failed") {
    throw new RtoWorkflowError(
      "RTO_CLOSE_BLOCKED",
      `RTO ${rtoId} can be closed only after qc_passed or qc_failed.`
    )
  }

  const transition = applyRtoTransition(intent, {
    action: "rto_close",
    to_state: "closed",
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

  await persistRtoIntent(scope, order, transition.intent)
  await emitRtoEvent(scope, "rto.closed", {
    order_id: order.id,
    rto_id: rtoId,
    actor_id: input.actor_id,
    reason: input.reason?.trim() || undefined,
  })

  return {
    order_id: order.id,
    rto_id: rtoId,
    from_state: transition.from_state,
    to_state: transition.to_state,
    changed: true,
  }
}
