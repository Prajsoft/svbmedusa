import {
  applyExchangeTransition,
  emitExchangeEvent,
  getExchangeIntentOrThrow,
  getOrder,
  normalizeExchangeId,
  persistExchangeIntent,
  requireIdempotencyKey,
  ExchangeWorkflowError,
} from "./shared"

export type ExchangeCloseWorkflowInput = {
  order_id: string
  exchange_id?: string
  idempotency_key: string
  actor_id?: string
  reason?: string
}

export type ExchangeCloseWorkflowResult = {
  order_id: string
  exchange_id: string
  from_state: string
  to_state: string
  changed: boolean
}

export async function exchangeCloseWorkflow(
  scope: { resolve: (key: string) => any },
  input: ExchangeCloseWorkflowInput
): Promise<ExchangeCloseWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new ExchangeWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const exchangeId = normalizeExchangeId(input.exchange_id)
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const order = await getOrder(scope, orderId)
  const intent = getExchangeIntentOrThrow(order, exchangeId)
  const replayEntry = intent.idempotency_log?.[idempotencyKey]

  if (replayEntry?.action === "exchange_close") {
    return {
      order_id: order.id,
      exchange_id: exchangeId,
      from_state: intent.state,
      to_state: intent.state,
      changed: false,
    }
  }

  if (
    intent.state !== "replacement_shipped" &&
    intent.state !== "delivered"
  ) {
    throw new ExchangeWorkflowError(
      "EXCHANGE_CLOSE_BLOCKED",
      `Exchange ${exchangeId} can be closed only after replacement is shipped or delivered.`
    )
  }

  const transition = applyExchangeTransition(intent, {
    action: "exchange_close",
    to_state: "closed",
    idempotency_key: idempotencyKey,
    actor_id: input.actor_id,
    reason: input.reason,
  })

  if (!transition.changed) {
    return {
      order_id: order.id,
      exchange_id: exchangeId,
      from_state: transition.from_state,
      to_state: transition.to_state,
      changed: false,
    }
  }

  await persistExchangeIntent(scope, order, transition.intent)
  await emitExchangeEvent(scope, "exchange.closed", {
    order_id: order.id,
    exchange_id: exchangeId,
    actor_id: input.actor_id,
    reason: input.reason?.trim() || undefined,
  })

  return {
    order_id: order.id,
    exchange_id: exchangeId,
    from_state: transition.from_state,
    to_state: transition.to_state,
    changed: true,
  }
}
