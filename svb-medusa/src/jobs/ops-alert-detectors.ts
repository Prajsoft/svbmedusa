import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { emitBusinessEvent } from "../modules/logging/business-events"
import { setCorrelationContext } from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"
import { COD_PAYMENT_PROVIDER_ID } from "../workflows/checkout/cod-checkout"

type ScopeLike = {
  resolve: (key: string) => any
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

type DetectorOptions = {
  now?: Date
  stuckFulfillmentMinutes?: number
  codCapturePendingDays?: number
  returnsQcStuckDays?: number
}

export type DetectorResult = {
  scanned_orders: number
  alerts_raised: number
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

type OpsAlertPayload = {
  type: "stuck_fulfillment" | "cod_capture_pending" | "returns_qc_stuck"
  severity: "medium" | "high"
  entity_id: string
  reason: string
  suggested_action: string
}

export const DEFAULT_STUCK_FULFILLMENT_MINUTES = 30
export const DEFAULT_COD_CAPTURE_PENDING_DAYS = 3
export const DEFAULT_RETURNS_QC_STUCK_DAYS = 2

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const floored = Math.floor(parsed)
  return floored > 0 ? floored : fallback
}

function toMs(input: Date): number {
  return input.getTime()
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

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function getNow(options?: DetectorOptions): Date {
  if (options?.now instanceof Date && Number.isFinite(toMs(options.now))) {
    return options.now
  }

  return new Date()
}

function getStuckFulfillmentThresholdMinutes(options?: DetectorOptions): number {
  if (typeof options?.stuckFulfillmentMinutes === "number") {
    return toPositiveInt(
      options.stuckFulfillmentMinutes,
      DEFAULT_STUCK_FULFILLMENT_MINUTES
    )
  }

  return toPositiveInt(
    process.env.OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES,
    DEFAULT_STUCK_FULFILLMENT_MINUTES
  )
}

function getCodCapturePendingThresholdDays(options?: DetectorOptions): number {
  if (typeof options?.codCapturePendingDays === "number") {
    return toPositiveInt(
      options.codCapturePendingDays,
      DEFAULT_COD_CAPTURE_PENDING_DAYS
    )
  }

  return toPositiveInt(
    process.env.OPS_COD_CAPTURE_PENDING_THRESHOLD_DAYS,
    DEFAULT_COD_CAPTURE_PENDING_DAYS
  )
}

function getReturnsQcStuckThresholdDays(options?: DetectorOptions): number {
  if (typeof options?.returnsQcStuckDays === "number") {
    return toPositiveInt(
      options.returnsQcStuckDays,
      DEFAULT_RETURNS_QC_STUCK_DAYS
    )
  }

  return toPositiveInt(
    process.env.OPS_RETURNS_QC_STUCK_THRESHOLD_DAYS,
    DEFAULT_RETURNS_QC_STUCK_DAYS
  )
}

async function getOrders(scope: ScopeLike): Promise<OrderLike[]> {
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

function getFulfillmentIntents(
  order: OrderLike
): Record<string, FulfillmentIntentRecord> {
  const metadata =
    order.metadata && typeof order.metadata === "object" ? order.metadata : {}
  const raw = metadata.fulfillment_intents_v1
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }

  return raw as Record<string, FulfillmentIntentRecord>
}

function getReturnIntents(order: OrderLike): Record<string, ReturnIntentRecord> {
  const metadata =
    order.metadata && typeof order.metadata === "object" ? order.metadata : {}
  const raw = metadata.return_intents_v1
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }

  return raw as Record<string, ReturnIntentRecord>
}

function getDeliveredAt(intent: FulfillmentIntentRecord): number | undefined {
  const history = Array.isArray(intent.status_history) ? intent.status_history : []
  const deliveredHistory = history
    .filter((entry) => entry?.to_status === "delivered")
    .map((entry) => parseDateMs(entry?.at))
    .filter((value): value is number => typeof value === "number")

  if (deliveredHistory.length) {
    return Math.max(...deliveredHistory)
  }

  if (intent.state === "delivered") {
    return parseDateMs(intent.last_transition_at)
  }

  return undefined
}

function getReceivedAt(intent: ReturnIntentRecord): number | undefined {
  const history = Array.isArray(intent.status_history) ? intent.status_history : []
  const receivedHistory = history
    .filter((entry) => entry?.to_status === "received")
    .map((entry) => parseDateMs(entry?.at))
    .filter((value): value is number => typeof value === "number")

  if (receivedHistory.length) {
    return Math.max(...receivedHistory)
  }

  if (intent.state === "received") {
    return parseDateMs(intent.updated_at)
  }

  return undefined
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

async function raiseOpsAlert(
  scope: ScopeLike,
  input: {
    workflowName: string
    orderId?: string
    returnId?: string
    payload: OpsAlertPayload
  }
): Promise<void> {
  await emitBusinessEvent(scope, {
    name: "ops.alert.raised",
    workflow_name: input.workflowName,
    step_name: "raise_alert",
    order_id: input.orderId,
    return_id: input.returnId,
    data: input.payload,
  })
}

export async function runStuckFulfillmentDetector(
  scope: ScopeLike,
  options?: DetectorOptions
): Promise<DetectorResult> {
  const now = getNow(options)
  const thresholdMinutes = getStuckFulfillmentThresholdMinutes(options)
  const cutoffMs = toMs(now) - thresholdMinutes * 60 * 1000

  setCorrelationContext({
    workflow_name: "stuck_fulfillment_detector",
  })

  const orders = await getOrders(scope)
  let alertsRaised = 0

  for (const order of orders) {
    const intents = getFulfillmentIntents(order)
    for (const [intentKey, intent] of Object.entries(intents)) {
      if (intent?.state !== "requested") {
        continue
      }

      const requestedAtMs = parseDateMs(intent.requested_at)
      if (typeof requestedAtMs !== "number" || requestedAtMs > cutoffMs) {
        continue
      }

      alertsRaised += 1
      await raiseOpsAlert(scope, {
        workflowName: "stuck_fulfillment_detector",
        orderId: order.id,
        payload: {
          type: "stuck_fulfillment",
          severity: "high",
          entity_id: `${order.id}:${intentKey}`,
          reason: `Fulfillment intent ${intentKey} is still in requested state for more than ${thresholdMinutes} minutes.`,
          suggested_action:
            "Review fulfillment intent and move it to ready_for_shipment or investigate fulfillment blockers.",
        },
      })
    }
  }

  logStructured(scope, "info", "stuck_fulfillment_detector completed", {
    workflow_name: "stuck_fulfillment_detector",
    step_name: "complete",
    meta: {
      scanned_orders: orders.length,
      alerts_raised: alertsRaised,
      threshold_minutes: thresholdMinutes,
    },
  })

  return {
    scanned_orders: orders.length,
    alerts_raised: alertsRaised,
  }
}

export async function runCodCapturePendingDetector(
  scope: ScopeLike,
  options?: DetectorOptions
): Promise<DetectorResult> {
  const now = getNow(options)
  const thresholdDays = getCodCapturePendingThresholdDays(options)
  const cutoffMs = toMs(now) - thresholdDays * 24 * 60 * 60 * 1000

  setCorrelationContext({
    workflow_name: "cod_capture_pending_detector",
  })

  const orders = await getOrders(scope)
  let alertsRaised = 0

  for (const order of orders) {
    if (!hasCodPayment(order) || isCodCaptured(order)) {
      continue
    }

    const intents = getFulfillmentIntents(order)
    const deliveredTimestamps = Object.values(intents)
      .map((intent) => getDeliveredAt(intent))
      .filter((value): value is number => typeof value === "number")

    if (!deliveredTimestamps.length) {
      continue
    }

    const deliveredAtMs = Math.max(...deliveredTimestamps)
    if (deliveredAtMs > cutoffMs) {
      continue
    }

    alertsRaised += 1
    await raiseOpsAlert(scope, {
      workflowName: "cod_capture_pending_detector",
      orderId: order.id,
      payload: {
        type: "cod_capture_pending",
        severity: "high",
        entity_id: order.id,
        reason: `Order is marked delivered but COD capture is still pending after ${thresholdDays} day(s).`,
        suggested_action:
          "Verify delivery confirmation and capture COD payment via admin COD capture operation.",
      },
    })
  }

  logStructured(scope, "info", "cod_capture_pending_detector completed", {
    workflow_name: "cod_capture_pending_detector",
    step_name: "complete",
    meta: {
      scanned_orders: orders.length,
      alerts_raised: alertsRaised,
      threshold_days: thresholdDays,
    },
  })

  return {
    scanned_orders: orders.length,
    alerts_raised: alertsRaised,
  }
}

export async function runReturnsQcStuckDetector(
  scope: ScopeLike,
  options?: DetectorOptions
): Promise<DetectorResult> {
  const now = getNow(options)
  const thresholdDays = getReturnsQcStuckThresholdDays(options)
  const cutoffMs = toMs(now) - thresholdDays * 24 * 60 * 60 * 1000

  setCorrelationContext({
    workflow_name: "returns_qc_stuck_detector",
  })

  const orders = await getOrders(scope)
  let alertsRaised = 0

  for (const order of orders) {
    const intents = getReturnIntents(order)
    for (const [intentKey, intent] of Object.entries(intents)) {
      if (intent?.state !== "received") {
        continue
      }

      const receivedAtMs = getReceivedAt(intent)
      if (typeof receivedAtMs !== "number" || receivedAtMs > cutoffMs) {
        continue
      }

      const returnId = normalizeString(intent.return_id) ?? intentKey
      alertsRaised += 1
      await raiseOpsAlert(scope, {
        workflowName: "returns_qc_stuck_detector",
        orderId: order.id,
        returnId,
        payload: {
          type: "returns_qc_stuck",
          severity: "medium",
          entity_id: returnId,
          reason: `Return ${returnId} has been in received state for more than ${thresholdDays} day(s) without a QC outcome.`,
          suggested_action:
            "Run return QC pass/fail workflow and close the return once QC is completed.",
        },
      })
    }
  }

  logStructured(scope, "info", "returns_qc_stuck_detector completed", {
    workflow_name: "returns_qc_stuck_detector",
    step_name: "complete",
    meta: {
      scanned_orders: orders.length,
      alerts_raised: alertsRaised,
      threshold_days: thresholdDays,
    },
  })

  return {
    scanned_orders: orders.length,
    alerts_raised: alertsRaised,
  }
}

export async function runAllOpsDetectors(
  scope: ScopeLike,
  options?: DetectorOptions
): Promise<{
  stuck_fulfillment: DetectorResult
  cod_capture_pending: DetectorResult
  returns_qc_stuck: DetectorResult
}> {
  const [stuckFulfillment, codCapturePending, returnsQcStuck] = await Promise.all([
    runStuckFulfillmentDetector(scope, options),
    runCodCapturePendingDetector(scope, options),
    runReturnsQcStuckDetector(scope, options),
  ])

  return {
    stuck_fulfillment: stuckFulfillment,
    cod_capture_pending: codCapturePending,
    returns_qc_stuck: returnsQcStuck,
  }
}

