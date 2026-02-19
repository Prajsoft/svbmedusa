import {
  applyExchangeTransition,
  applyInventoryMovementForExchange,
  emitExchangeEvent,
  getExchangeIntentOrThrow,
  getOrder,
  normalizeExchangeId,
  persistExchangeIntent,
  requireIdempotencyKey,
  ExchangeWorkflowError,
} from "./shared"

export type ExchangeReceiveReturnWorkflowInput = {
  order_id: string
  exchange_id?: string
  idempotency_key: string
  actor_id?: string
  reason?: string
}

export type ExchangeReceiveReturnWorkflowResult = {
  order_id: string
  exchange_id: string
  from_state: string
  to_state: string
  changed: boolean
}

export async function exchangeReceiveReturnWorkflow(
  scope: { resolve: (key: string) => any },
  input: ExchangeReceiveReturnWorkflowInput
): Promise<ExchangeReceiveReturnWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new ExchangeWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const exchangeId = normalizeExchangeId(input.exchange_id)
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const order = await getOrder(scope, orderId)
  const intent = getExchangeIntentOrThrow(order, exchangeId)

  const transition = applyExchangeTransition(intent, {
    action: "exchange_receive_return",
    to_state: "return_received",
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

  const inventoryMovement = await applyInventoryMovementForExchange(
    scope,
    transition.intent,
    "return_to_qc_hold"
  )

  await persistExchangeIntent(scope, order, inventoryMovement.intent)
  await emitExchangeEvent(scope, "exchange.return_received", {
    order_id: order.id,
    exchange_id: exchangeId,
    actor_id: input.actor_id,
    reason: input.reason?.trim() || undefined,
    inventory_move: inventoryMovement.movement,
  })

  return {
    order_id: order.id,
    exchange_id: exchangeId,
    from_state: transition.from_state,
    to_state: transition.to_state,
    changed: true,
  }
}
