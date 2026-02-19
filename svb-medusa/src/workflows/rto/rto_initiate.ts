import {
  assertCodNotCapturedForRto,
  createRtoIntent,
  emitRtoEvent,
  getOrder,
  getRtoIntent,
  normalizeRtoId,
  persistRtoIntent,
  requireIdempotencyKey,
  resolveRtoItems,
  type ReturnItemInput,
  RtoWorkflowError,
} from "./shared"

export type RtoInitiateWorkflowInput = {
  order_id: string
  rto_id?: string
  idempotency_key: string
  actor_id?: string
  note?: string
  items?: ReturnItemInput[]
}

export type RtoInitiateWorkflowResult = {
  order_id: string
  rto_id: string
  state: "initiated"
  changed: boolean
}

export async function rtoInitiateWorkflow(
  scope: { resolve: (key: string) => any },
  input: RtoInitiateWorkflowInput
): Promise<RtoInitiateWorkflowResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new RtoWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
  const rtoId = normalizeRtoId(input.rto_id)
  const order = await getOrder(scope, orderId)
  assertCodNotCapturedForRto(order)

  const existingIntent = getRtoIntent(order, rtoId)
  if (existingIntent) {
    const replayEntry = existingIntent.idempotency_log?.[idempotencyKey]
    if (replayEntry?.action === "rto_initiate") {
      return {
        order_id: order.id,
        rto_id: rtoId,
        state: "initiated",
        changed: false,
      }
    }

    throw new RtoWorkflowError(
      "RTO_ALREADY_EXISTS",
      `RTO ${rtoId} already exists for order ${order.id}.`
    )
  }

  const items = await resolveRtoItems(scope, order, input.items)
  const intent = createRtoIntent({
    order_id: order.id,
    rto_id: rtoId,
    note: input.note,
    items,
    idempotency_key: idempotencyKey,
    actor_id: input.actor_id,
  })

  await persistRtoIntent(scope, order, intent)
  await emitRtoEvent(scope, "rto.initiated", {
    order_id: order.id,
    rto_id: rtoId,
    actor_id: input.actor_id,
    item_count: intent.items.length,
  })

  return {
    order_id: order.id,
    rto_id: rtoId,
    state: "initiated",
    changed: true,
  }
}
