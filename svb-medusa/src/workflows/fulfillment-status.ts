import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { emitBusinessEvent } from "../modules/logging/business-events"
import { setCorrelationContext } from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"

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

type ShipmentContractSummary = {
  pickup_location_code: string
  package_count: number
  total_weight_grams: number
  cod: {
    enabled: boolean
    amount: number
  }
  invoice_ref: string
}

type FulfillmentIntentRecord = {
  idempotency_key: string
  fulfillment_attempt: number
  state: FulfillmentStatus
  requested_at: string
  shipment_contract_summary: ShipmentContractSummary
  status_history?: Array<{
    from_status: FulfillmentStatus
    to_status: FulfillmentStatus
    at: string
    actor_id?: string
    reason?: string
  }>
  last_transition_at?: string
}

type OrderLike = {
  id: string
  metadata?: Record<string, unknown> | null
}

export type TransitionFulfillmentStatusInput = {
  order_id: string
  to_status: FulfillmentStatus
  fulfillment_attempt?: number
  actor_id?: string
  reason?: string
  correlation_id?: string
}

export type TransitionFulfillmentStatusResult = {
  order_id: string
  idempotency_key: string
  changed: boolean
  from_status: FulfillmentStatus
  to_status: FulfillmentStatus
}

export class FulfillmentStatusTransitionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "FulfillmentStatusTransitionError"
    this.code = code
  }
}

const ALLOWED_NEXT_STATUS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  requested: ["ready_for_shipment"],
  ready_for_shipment: ["shipped"],
  shipped: ["delivered"],
  delivered: ["rto_initiated"],
  delivery_failed: ["rto_initiated"],
  rto_initiated: ["rto_delivered"],
  rto_delivered: [],
}

const ALL_STATUSES = new Set<FulfillmentStatus>([
  "requested",
  "ready_for_shipment",
  "shipped",
  "delivered",
  "delivery_failed",
  "rto_initiated",
  "rto_delivered",
])

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function normalizeAttempt(value?: number): number {
  const parsed = Math.floor(toNumber(value))
  return parsed > 0 ? parsed : 1
}

function getIdempotencyKey(orderId: string, fulfillmentAttempt: number): string {
  return `${orderId}:${fulfillmentAttempt}`
}

async function getOrder(scope: ScopeLike, orderId: string): Promise<OrderLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: orderId },
  })

  const order = first<OrderLike>(data)
  if (!order) {
    throw new FulfillmentStatusTransitionError(
      "ORDER_NOT_FOUND",
      `Order ${orderId} was not found.`
    )
  }

  return order
}

function getFulfillmentIntents(
  metadata: Record<string, unknown> | null | undefined
): Record<string, FulfillmentIntentRecord> {
  const value = metadata?.fulfillment_intents_v1
  if (!value || typeof value !== "object") {
    return {}
  }

  return value as Record<string, FulfillmentIntentRecord>
}

function isAllowedTransition(
  fromStatus: FulfillmentStatus,
  toStatus: FulfillmentStatus
): boolean {
  return ALLOWED_NEXT_STATUS[fromStatus].includes(toStatus)
}

function assertTargetStatus(value: string): asserts value is FulfillmentStatus {
  if (!ALL_STATUSES.has(value as FulfillmentStatus)) {
    throw new FulfillmentStatusTransitionError(
      "INVALID_FULFILLMENT_STATUS",
      `Invalid fulfillment status: ${value}.`
    )
  }
}

function buildUpdatedMetadata(
  order: OrderLike,
  idempotencyKey: string,
  updatedIntent: FulfillmentIntentRecord
): Record<string, unknown> {
  const currentMetadata =
    order.metadata && typeof order.metadata === "object" ? order.metadata : {}
  const currentIntents = getFulfillmentIntents(currentMetadata)

  return {
    ...currentMetadata,
    fulfillment_state_v1: updatedIntent.state,
    fulfillment_intents_v1: {
      ...currentIntents,
      [idempotencyKey]: updatedIntent,
    },
  }
}

export async function transitionFulfillmentStatusWorkflow(
  scope: ScopeLike,
  input: TransitionFulfillmentStatusInput
): Promise<TransitionFulfillmentStatusResult> {
  const orderId = input.order_id?.trim()
  if (!orderId) {
    throw new FulfillmentStatusTransitionError(
      "ORDER_ID_REQUIRED",
      "order_id is required."
    )
  }

  const rawToStatus = (input.to_status ?? "").trim()
  assertTargetStatus(rawToStatus)
  const toStatus = rawToStatus

  const fulfillmentAttempt = normalizeAttempt(input.fulfillment_attempt)
  const idempotencyKey = getIdempotencyKey(orderId, fulfillmentAttempt)

  setCorrelationContext({
    correlation_id: input.correlation_id,
    workflow_name: "fulfillment_status_transition",
    order_id: orderId,
  })
  logStructured(scope as any, "info", "Transitioning fulfillment status", {
    workflow_name: "fulfillment_status_transition",
    step_name: "start",
    order_id: orderId,
    meta: {
      to_status: toStatus,
      fulfillment_attempt: fulfillmentAttempt,
    },
  })

  const order = await getOrder(scope, orderId)
  const intents = getFulfillmentIntents(order.metadata)
  const currentIntent = intents[idempotencyKey]

  if (!currentIntent) {
    throw new FulfillmentStatusTransitionError(
      "FULFILLMENT_INTENT_NOT_FOUND",
      `Fulfillment intent ${idempotencyKey} not found for order ${orderId}.`
    )
  }

  const fromStatus = currentIntent.state

  if (fromStatus === toStatus) {
    return {
      order_id: order.id,
      idempotency_key: idempotencyKey,
      changed: false,
      from_status: fromStatus,
      to_status: toStatus,
    }
  }

  if (!isAllowedTransition(fromStatus, toStatus)) {
    throw new FulfillmentStatusTransitionError(
      "INVALID_FULFILLMENT_STATUS_TRANSITION",
      `Cannot move fulfillment intent from ${fromStatus} to ${toStatus}.`
    )
  }

  const now = new Date().toISOString()
  const updatedIntent: FulfillmentIntentRecord = {
    ...currentIntent,
    state: toStatus,
    last_transition_at: now,
    status_history: [
      ...(currentIntent.status_history ?? []),
      {
        from_status: fromStatus,
        to_status: toStatus,
        at: now,
        actor_id: input.actor_id,
        reason: input.reason?.trim() || undefined,
      },
    ],
  }

  const orderModule = scope.resolve(Modules.ORDER)
  await orderModule.updateOrders(order.id, {
    metadata: buildUpdatedMetadata(order, idempotencyKey, updatedIntent),
  })

  await emitBusinessEvent(scope as any, {
    name: "fulfillment.status_changed",
    correlation_id: input.correlation_id,
    workflow_name: "fulfillment_status_transition",
    step_name: "emit_event",
    order_id: order.id,
    data: {
      order_id: order.id,
      idempotency_key: idempotencyKey,
      fulfillment_attempt: fulfillmentAttempt,
      from_status: fromStatus,
      to_status: toStatus,
      actor_id: input.actor_id,
      reason: input.reason?.trim() || undefined,
    },
  })

  return {
    order_id: order.id,
    idempotency_key: idempotencyKey,
    changed: true,
    from_status: fromStatus,
    to_status: toStatus,
  }
}
