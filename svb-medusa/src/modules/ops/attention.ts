import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getAuditTimelineForOrder } from "../observability/business-events"

type ScopeLike = {
  resolve: (key: string) => any
}

type FulfillmentStatus =
  | "requested"
  | "ready_for_shipment"
  | "shipped"
  | "delivered"
  | "delivery_failed"
  | "rto_initiated"
  | "rto_delivered"

type FulfillmentIntentRecord = {
  state?: FulfillmentStatus
  requested_at?: string
  last_transition_at?: string
  status_history?: Array<{
    to_status?: FulfillmentStatus
    at?: string
  }>
}

type ReturnState =
  | "requested"
  | "approved"
  | "received"
  | "qc_passed"
  | "qc_failed"
  | "refunded"
  | "closed"

type ReturnIntentRecord = {
  return_id?: string
  state?: ReturnState
  updated_at?: string
  status_history?: Array<{
    to_status?: ReturnState | null
    at?: string
  }>
}

type OrderLike = {
  id: string
  metadata?: Record<string, unknown> | null
  payment_collections?: Array<{
    payments?: Array<{
      id?: string | null
      provider_id?: string | null
      captured_at?: string | null
      data?: Record<string, unknown> | null
    }> | null
  }> | null
}

type TimelineEvent = {
  id?: string
  name: string
  created_at: string
  payload: Record<string, unknown>
  correlation_id: string
  entity_refs: Array<{ type: string; id: string }>
  actor: { type: string; id?: string }
  schema_version: string
}

export type OpsAttentionItem = {
  entity_id: string
  current_state: string
  last_event_name: string | null
  last_event_time: string | null
  last_error_code: string | null
  suggested_action: string
}

const COD_PAYMENT_PROVIDER_ID = "pp_cod_cod"
const DEFAULT_STUCK_FULFILLMENT_MINUTES = 30
const DEFAULT_COD_CAPTURE_PENDING_DAYS = 3
const DEFAULT_RETURNS_QC_STUCK_DAYS = 2

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const floored = Math.floor(parsed)
  return floored > 0 ? floored : fallback
}

function parseDateMs(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) {
    return undefined
  }

  return parsed
}

function getStuckFulfillmentThresholdMinutes(): number {
  return toPositiveInt(
    process.env.OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES,
    DEFAULT_STUCK_FULFILLMENT_MINUTES
  )
}

function getCodCapturePendingThresholdDays(): number {
  return toPositiveInt(
    process.env.OPS_COD_CAPTURE_PENDING_THRESHOLD_DAYS,
    DEFAULT_COD_CAPTURE_PENDING_DAYS
  )
}

function getReturnsQcStuckThresholdDays(): number {
  return toPositiveInt(
    process.env.OPS_RETURNS_QC_STUCK_THRESHOLD_DAYS,
    DEFAULT_RETURNS_QC_STUCK_DAYS
  )
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function getOrdersMetadata(order: OrderLike): Record<string, unknown> {
  return order.metadata && typeof order.metadata === "object" ? order.metadata : {}
}

function getFulfillmentIntents(
  order: OrderLike
): Record<string, FulfillmentIntentRecord> {
  const metadata = getOrdersMetadata(order)
  const raw = metadata.fulfillment_intents_v1
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }

  return raw as Record<string, FulfillmentIntentRecord>
}

function getReturnIntents(order: OrderLike): Record<string, ReturnIntentRecord> {
  const metadata = getOrdersMetadata(order)
  const raw = metadata.return_intents_v1
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }

  return raw as Record<string, ReturnIntentRecord>
}

function getLastErrorCode(order: OrderLike): string | null {
  const metadata = getOrdersMetadata(order)
  const fromFulfillment = metadata.fulfillment_last_error_v1
  if (
    fromFulfillment &&
    typeof fromFulfillment === "object" &&
    typeof (fromFulfillment as { code?: unknown }).code === "string"
  ) {
    const code = (fromFulfillment as { code: string }).code.trim()
    if (code) {
      return code
    }
  }

  const fromGeneric = metadata.last_error_code
  if (typeof fromGeneric === "string" && fromGeneric.trim()) {
    return fromGeneric.trim()
  }

  return null
}

function getDeliveredAt(intent: FulfillmentIntentRecord): number | undefined {
  const history = Array.isArray(intent.status_history) ? intent.status_history : []
  const deliveredEntries = history
    .filter((entry) => entry?.to_status === "delivered")
    .map((entry) => parseDateMs(entry?.at))
    .filter((value): value is number => typeof value === "number")

  if (deliveredEntries.length) {
    return Math.max(...deliveredEntries)
  }

  if (intent.state === "delivered") {
    return parseDateMs(intent.last_transition_at)
  }

  return undefined
}

function getReturnReceivedAt(intent: ReturnIntentRecord): number | undefined {
  const history = Array.isArray(intent.status_history) ? intent.status_history : []
  const receivedEntries = history
    .filter((entry) => entry?.to_status === "received")
    .map((entry) => parseDateMs(entry?.at))
    .filter((value): value is number => typeof value === "number")

  if (receivedEntries.length) {
    return Math.max(...receivedEntries)
  }

  if (intent.state === "received") {
    return parseDateMs(intent.updated_at)
  }

  return undefined
}

function hasCodPayment(order: OrderLike): boolean {
  const collections = Array.isArray(order.payment_collections)
    ? order.payment_collections
    : []

  for (const collection of collections) {
    const payments = Array.isArray(collection?.payments) ? collection.payments : []
    for (const payment of payments) {
      if (payment?.provider_id === COD_PAYMENT_PROVIDER_ID) {
        return true
      }
    }
  }

  return false
}

function isCodCaptured(order: OrderLike): boolean {
  const collections = Array.isArray(order.payment_collections)
    ? order.payment_collections
    : []

  for (const collection of collections) {
    const payments = Array.isArray(collection?.payments) ? collection.payments : []
    for (const payment of payments) {
      if (payment?.provider_id !== COD_PAYMENT_PROVIDER_ID) {
        continue
      }

      if (normalizeString(payment.captured_at)) {
        return true
      }

      const codState = normalizeString(payment.data?.cod_state)
      if (codState === "captured" || codState === "refunded") {
        return true
      }
    }
  }

  return false
}

async function listOrders(scope: ScopeLike): Promise<OrderLike[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "metadata",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.data",
    ],
    filters: {},
  })

  return Array.isArray(data) ? (data as OrderLike[]) : []
}

function getLastMatchingEvent(
  timeline: TimelineEvent[],
  predicate?: (event: TimelineEvent) => boolean
): { name: string; time: string } | null {
  const events = predicate ? timeline.filter(predicate) : timeline
  if (!events.length) {
    return null
  }

  const last = events[events.length - 1]
  return {
    name: last.name,
    time: last.created_at,
  }
}

async function buildOrderTimelineCache(
  scope: ScopeLike,
  orderIds: string[]
): Promise<Map<string, TimelineEvent[]>> {
  const cache = new Map<string, TimelineEvent[]>()
  const uniqueOrderIds = Array.from(new Set(orderIds))

  for (const orderId of uniqueOrderIds) {
    const timeline = (await getAuditTimelineForOrder(orderId, {
      scope,
    })) as TimelineEvent[]
    cache.set(orderId, timeline)
  }

  return cache
}

function sortItems(items: OpsAttentionItem[]): OpsAttentionItem[] {
  return [...items].sort((a, b) => a.entity_id.localeCompare(b.entity_id))
}

export async function getOrdersAttention(
  scope: ScopeLike
): Promise<OpsAttentionItem[]> {
  const orders = await listOrders(scope)
  const timelineCache = await buildOrderTimelineCache(
    scope,
    orders.map((order) => order.id)
  )

  const items: OpsAttentionItem[] = []

  for (const order of orders) {
    const metadata = getOrdersMetadata(order)
    const currentState =
      normalizeString(metadata.fulfillment_state_v1) ?? "unknown"
    const lastErrorCode = getLastErrorCode(order)
    const needsAttention = currentState === "pending" || !!lastErrorCode
    if (!needsAttention) {
      continue
    }

    const timeline = timelineCache.get(order.id) ?? []
    const lastEvent = getLastMatchingEvent(timeline)

    items.push({
      entity_id: order.id,
      current_state: currentState,
      last_event_name: lastEvent?.name ?? null,
      last_event_time: lastEvent?.time ?? null,
      last_error_code: lastErrorCode,
      suggested_action:
        currentState === "pending"
          ? "Review order fulfillment failure and rerun fulfillment request."
          : "Inspect last error and execute the relevant admin workflow action.",
    })
  }

  return sortItems(items)
}

export async function getFulfillmentsAttention(
  scope: ScopeLike
): Promise<OpsAttentionItem[]> {
  const nowMs = Date.now()
  const thresholdMs = getStuckFulfillmentThresholdMinutes() * 60 * 1000
  const cutoffMs = nowMs - thresholdMs
  const orders = await listOrders(scope)
  const timelineCache = await buildOrderTimelineCache(
    scope,
    orders.map((order) => order.id)
  )

  const items: OpsAttentionItem[] = []

  for (const order of orders) {
    const intents = getFulfillmentIntents(order)
    const timeline = timelineCache.get(order.id) ?? []
    const lastFulfillmentEvent = getLastMatchingEvent(
      timeline,
      (event) => event.name.startsWith("fulfillment.")
    )
    const lastErrorCode = getLastErrorCode(order)

    for (const [intentKey, intent] of Object.entries(intents)) {
      const state = normalizeString(intent.state) ?? "unknown"
      const requestedAtMs = parseDateMs(intent.requested_at)
      const stuckRequested =
        state === "requested" &&
        typeof requestedAtMs === "number" &&
        requestedAtMs <= cutoffMs
      const failedDelivery = state === "delivery_failed"

      if (!stuckRequested && !failedDelivery) {
        continue
      }

      items.push({
        entity_id: `${order.id}:${intentKey}`,
        current_state: state,
        last_event_name: lastFulfillmentEvent?.name ?? null,
        last_event_time: lastFulfillmentEvent?.time ?? null,
        last_error_code: lastErrorCode,
        suggested_action: stuckRequested
          ? "Move fulfillment to ready_for_shipment or investigate fulfillment blockers."
          : "Review delivery failure and move to rto_initiated if needed.",
      })
    }
  }

  return sortItems(items)
}

export async function getCodAttention(scope: ScopeLike): Promise<OpsAttentionItem[]> {
  const nowMs = Date.now()
  const thresholdMs = getCodCapturePendingThresholdDays() * 24 * 60 * 60 * 1000
  const cutoffMs = nowMs - thresholdMs
  const orders = await listOrders(scope)
  const timelineCache = await buildOrderTimelineCache(
    scope,
    orders.map((order) => order.id)
  )

  const items: OpsAttentionItem[] = []

  for (const order of orders) {
    if (!hasCodPayment(order) || isCodCaptured(order)) {
      continue
    }

    const intents = getFulfillmentIntents(order)
    const deliveredAtValues = Object.values(intents)
      .map((intent) => getDeliveredAt(intent))
      .filter((value): value is number => typeof value === "number")

    if (!deliveredAtValues.length) {
      continue
    }

    const deliveredAtMs = Math.max(...deliveredAtValues)
    if (deliveredAtMs > cutoffMs) {
      continue
    }

    const timeline = timelineCache.get(order.id) ?? []
    const lastCodEvent = getLastMatchingEvent(
      timeline,
      (event) => event.name.startsWith("cod.") || event.name === "payment.authorized"
    )

    items.push({
      entity_id: order.id,
      current_state: "capture_pending",
      last_event_name: lastCodEvent?.name ?? null,
      last_event_time: lastCodEvent?.time ?? null,
      last_error_code: getLastErrorCode(order),
      suggested_action:
        "Verify delivery status and capture COD payment using the admin COD capture action.",
    })
  }

  return sortItems(items)
}

export async function getReturnsAttention(
  scope: ScopeLike
): Promise<OpsAttentionItem[]> {
  const nowMs = Date.now()
  const thresholdMs = getReturnsQcStuckThresholdDays() * 24 * 60 * 60 * 1000
  const cutoffMs = nowMs - thresholdMs
  const orders = await listOrders(scope)
  const timelineCache = await buildOrderTimelineCache(
    scope,
    orders.map((order) => order.id)
  )

  const items: OpsAttentionItem[] = []

  for (const order of orders) {
    const intents = getReturnIntents(order)
    const timeline = timelineCache.get(order.id) ?? []
    const lastErrorCode = getLastErrorCode(order)

    for (const [intentKey, intent] of Object.entries(intents)) {
      const state = normalizeString(intent.state) ?? "unknown"
      if (state !== "received") {
        continue
      }

      const receivedAtMs = getReturnReceivedAt(intent)
      if (typeof receivedAtMs !== "number" || receivedAtMs > cutoffMs) {
        continue
      }

      const returnId = normalizeString(intent.return_id) ?? intentKey
      const lastReturnEvent = getLastMatchingEvent(
        timeline,
        (event) =>
          event.name.startsWith("return.") &&
          normalizeString(event.payload?.return_id) === returnId
      )

      items.push({
        entity_id: returnId,
        current_state: state,
        last_event_name: lastReturnEvent?.name ?? null,
        last_event_time: lastReturnEvent?.time ?? null,
        last_error_code: lastErrorCode,
        suggested_action:
          "Run return QC pass/fail workflow and close the return after QC completes.",
      })
    }
  }

  return sortItems(items)
}

export async function getOrderTimeline(
  scope: ScopeLike,
  orderId: string,
  limit?: number
): Promise<TimelineEvent[]> {
  const normalizedOrderId = normalizeString(orderId)
  if (!normalizedOrderId) {
    return []
  }

  const timeline = (await getAuditTimelineForOrder(normalizedOrderId, {
    scope,
    limit,
  })) as TimelineEvent[]

  return timeline
}
