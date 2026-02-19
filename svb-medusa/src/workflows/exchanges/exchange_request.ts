import {
  assertReturnReasonCode,
  createExchangeIntent,
  emitExchangeEvent,
  getExchangeIntent,
  getOrder,
  normalizeExchangeId,
  persistExchangeIntent,
  requireIdempotencyKey,
  resolveExchangeReturnItems,
  resolveReplacementItems,
  type ExchangeReplacementItemInput,
  type ReturnItemInput,
  type ReturnReasonCode,
  ExchangeWorkflowError,
} from "./shared"

export type ExchangeRequestWorkflowInput = {
  order_id: string
  exchange_id?: string
  idempotency_key: string
  reason_code: ReturnReasonCode
  note?: string
  actor_id?: string
  return_items?: ReturnItemInput[]
  replacement_items?: ExchangeReplacementItemInput[]
}

export type ExchangeRequestWorkflowResult = {
  order_id: string
  exchange_id: string
  state: "requested"
  changed: boolean
}

export async function exchangeRequestWorkflow(
  scope: { resolve: (key: string) => any },
  input: ExchangeRequestWorkflowInput
): Promise<ExchangeRequestWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new ExchangeWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const exchangeId = normalizeExchangeId(input.exchange_id)
  const rawReason = String(input.reason_code ?? "").trim()
  assertReturnReasonCode(rawReason)
  const reasonCode = rawReason as ReturnReasonCode

  const order = await getOrder(scope, orderId)
  const existingIntent = getExchangeIntent(order, exchangeId)

  if (existingIntent) {
    const replayEntry = existingIntent.idempotency_log?.[idempotencyKey]
    if (replayEntry?.action === "exchange_request") {
      return {
        order_id: order.id,
        exchange_id: exchangeId,
        state: "requested",
        changed: false,
      }
    }

    throw new ExchangeWorkflowError(
      "EXCHANGE_ALREADY_EXISTS",
      `Exchange ${exchangeId} already exists for order ${order.id}.`
    )
  }

  const returnItems = await resolveExchangeReturnItems(
    scope,
    order,
    input.return_items
  )
  const replacementItems = await resolveReplacementItems(
    scope,
    order,
    returnItems,
    input.replacement_items
  )

  const intent = createExchangeIntent({
    order_id: order.id,
    exchange_id: exchangeId,
    reason_code: reasonCode,
    note: input.note,
    return_items: returnItems,
    replacement_items: replacementItems,
    idempotency_key: idempotencyKey,
    actor_id: input.actor_id,
  })

  await persistExchangeIntent(scope, order, intent)
  await emitExchangeEvent(scope, "exchange.requested", {
    order_id: order.id,
    exchange_id: exchangeId,
    reason_code: reasonCode,
    actor_id: input.actor_id,
    return_item_count: intent.return_items.length,
    replacement_item_count: intent.replacement_items.length,
  })

  return {
    order_id: order.id,
    exchange_id: exchangeId,
    state: "requested",
    changed: true,
  }
}
