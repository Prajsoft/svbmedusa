import {
  applyExchangeTransition,
  applyInventoryMovementForExchange,
  assertReplacementAvailability,
  emitExchangeEvent,
  getExchangeIntentOrThrow,
  getOrder,
  normalizeExchangeId,
  persistExchangeIntent,
  requireIdempotencyKey,
  ExchangeWorkflowError,
} from "./shared"

export type ExchangeReserveReplacementWorkflowInput = {
  order_id: string
  exchange_id?: string
  idempotency_key: string
  actor_id?: string
  reason?: string
}

export type ExchangeReserveReplacementWorkflowResult = {
  order_id: string
  exchange_id: string
  from_state: string
  to_state: string
  changed: boolean
}

export async function exchangeReserveReplacementWorkflow(
  scope: { resolve: (key: string) => any },
  input: ExchangeReserveReplacementWorkflowInput
): Promise<ExchangeReserveReplacementWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new ExchangeWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const exchangeId = normalizeExchangeId(input.exchange_id)
  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const order = await getOrder(scope, orderId)
  const intent = getExchangeIntentOrThrow(order, exchangeId)

  const transition = applyExchangeTransition(intent, {
    action: "exchange_reserve_replacement",
    to_state: "replacement_reserved",
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

  await assertReplacementAvailability(scope, transition.intent)
  const inventoryMovement = await applyInventoryMovementForExchange(
    scope,
    transition.intent,
    "reserve_replacement"
  )

  await persistExchangeIntent(scope, order, inventoryMovement.intent)
  await emitExchangeEvent(scope, "exchange.replacement_reserved", {
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
