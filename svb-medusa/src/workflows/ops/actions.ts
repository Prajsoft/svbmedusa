import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  buildShipmentContract,
  type ShipmentContract,
} from "../../modules/shipping/build-shipment-contract"
import { emitBusinessEvent } from "../../modules/logging/business-events"
import { setCorrelationContext } from "../../modules/logging/correlation"
import { logStructured } from "../../modules/logging/structured-logger"
import { fulfillmentRequestWorkflow } from "../fulfillment_request"
import {
  captureCodPaymentWorkflow,
  recordCodRefundWorkflow,
} from "../cod/admin-operations"

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
  fulfillment_attempt?: number
  state?: FulfillmentStatus
  shipment_contract_summary?: ShipmentContractSummary
}

type OrderLike = {
  id: string
  display_id?: string | number | null
  total?: number | string | null
  metadata?: Record<string, unknown> | null
  shipping_address?: Record<string, unknown> | null
  items?: Array<{
    id?: string
    title?: string | null
    quantity?: number | string | null
    variant?: {
      id?: string
      sku?: string | null
      title?: string | null
      metadata?: Record<string, unknown> | null
    } | null
  }>
  payment_collections?: Array<{
    payments?: Array<{
      provider_id?: string | null
      amount?: number | string | null
    }> | null
  }> | null
}

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

type ActionStatus = "applied" | "noop"

export type RetryFulfillmentActionInput = {
  order_id: string
  actor_id?: string
  correlation_id?: string
}

export type RetryFulfillmentActionResult = {
  order_id: string
  status: ActionStatus
  fulfillment_attempt: number
}

export type RebuildShipmentContractActionInput = {
  order_id: string
  actor_id?: string
  correlation_id?: string
}

export type RebuildShipmentContractActionResult = {
  order_id: string
  status: ActionStatus
  fulfillment_attempt: number
}

export type MarkCodCapturedActionInput = {
  order_id: string
  actor_id?: string
  correlation_id?: string
}

export type MarkCodCapturedActionResult = {
  order_id: string
  status: ActionStatus
  payment_id: string
}

export type RecordCodRefundActionInput = {
  order_id: string
  amount: number
  reason: string
  actor_id?: string
  correlation_id?: string
}

export type RecordCodRefundActionResult = {
  order_id: string
  status: ActionStatus
  payment_id: string
}

export class OpsActionWorkflowError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "OpsActionWorkflowError"
    this.code = code
  }
}

function normalizeOrderId(value: string): string {
  return value.trim()
}

function normalizeActor(actorId?: string): { type: "admin" | "system"; id?: string } {
  const normalized = typeof actorId === "string" ? actorId.trim() : ""
  if (!normalized) {
    return { type: "system" }
  }

  return { type: "admin", id: normalized }
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

function parseDateLike(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function getFulfillmentIntents(
  metadata: Record<string, unknown> | null | undefined
): Record<string, FulfillmentIntentRecord> {
  const raw = metadata?.fulfillment_intents_v1
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }

  return raw as Record<string, FulfillmentIntentRecord>
}

function resolveAttempt(intentKey: string, intent: FulfillmentIntentRecord): number {
  const fromRecord = Math.floor(toNumber(intent.fulfillment_attempt))
  if (fromRecord > 0) {
    return fromRecord
  }

  const match = intentKey.match(/:(\d+)$/)
  if (!match) {
    return 1
  }

  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function getLatestIntent(
  intents: Record<string, FulfillmentIntentRecord>
): { key: string; intent: FulfillmentIntentRecord; attempt: number } | undefined {
  const entries = Object.entries(intents)
  if (!entries.length) {
    return undefined
  }

  let latest: { key: string; intent: FulfillmentIntentRecord; attempt: number } | undefined
  for (const [key, intent] of entries) {
    const attempt = resolveAttempt(key, intent ?? {})
    if (!latest || attempt > latest.attempt) {
      latest = { key, intent: intent ?? {}, attempt }
    }
  }

  return latest
}

function buildShipmentContractSummary(
  contract: ShipmentContract
): ShipmentContractSummary {
  const totalWeight = contract.packages.reduce(
    (sum, pkg) => sum + toNumber(pkg.weight_grams),
    0
  )

  return {
    pickup_location_code: contract.pickup_location_code,
    package_count: contract.packages.length,
    total_weight_grams: Math.round(totalWeight * 100) / 100,
    cod: {
      enabled: contract.cod.enabled,
      amount: contract.cod.amount,
    },
    invoice_ref: contract.invoice_ref,
  }
}

function summariesEqual(
  left: ShipmentContractSummary | undefined,
  right: ShipmentContractSummary
): boolean {
  if (!left) {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
}

async function getOrder(scope: ScopeLike, orderId: string): Promise<OrderLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "total",
      "metadata",
      "shipping_address.*",
      "items.id",
      "items.title",
      "items.quantity",
      "items.variant.id",
      "items.variant.sku",
      "items.variant.title",
      "items.variant.metadata",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
    ],
    filters: { id: orderId },
  })

  const order = Array.isArray(data) ? data[0] : data
  if (!order || typeof order !== "object") {
    throw new OpsActionWorkflowError(
      "ORDER_NOT_FOUND",
      `Order ${orderId} was not found.`
    )
  }

  return order as OrderLike
}

async function emitOpsActionExecuted(
  scope: ScopeLike,
  input: {
    correlation_id?: string
    actor_id?: string
    order_id: string
    action: string
    status: ActionStatus
    details?: Record<string, unknown>
  }
): Promise<void> {
  await emitBusinessEvent(scope as any, {
    name: "ops.action.executed",
    correlation_id: input.correlation_id,
    workflow_name: "ops_actions",
    step_name: "emit_event",
    order_id: input.order_id,
    actor: normalizeActor(input.actor_id),
    data: {
      action: input.action,
      order_id: input.order_id,
      status: input.status,
      actor_id: input.actor_id,
      ...(input.details ?? {}),
    },
  })
}

export async function retryFulfillmentActionWorkflow(
  scope: ScopeLike,
  input: RetryFulfillmentActionInput
): Promise<RetryFulfillmentActionResult> {
  const orderId = normalizeOrderId(input.order_id ?? "")
  if (!orderId) {
    throw new OpsActionWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  setCorrelationContext({
    correlation_id: input.correlation_id,
    workflow_name: "ops_retry_fulfillment_action",
    order_id: orderId,
  })
  logStructured(scope as any, "info", "Executing retry fulfillment action", {
    workflow_name: "ops_retry_fulfillment_action",
    step_name: "start",
    order_id: orderId,
  })

  const order = await getOrder(scope, orderId)
  const intents = getFulfillmentIntents(order.metadata)
  const latest = getLatestIntent(intents)

  if (latest?.intent?.state === "requested") {
    await emitOpsActionExecuted(scope, {
      correlation_id: input.correlation_id,
      actor_id: input.actor_id,
      order_id: orderId,
      action: "retry-fulfillment",
      status: "noop",
      details: {
        fulfillment_attempt: latest.attempt,
        reason: "latest_fulfillment_intent_already_requested",
      },
    })

    return {
      order_id: orderId,
      status: "noop",
      fulfillment_attempt: latest.attempt,
    }
  }

  const attempt = latest ? latest.attempt + 1 : 1
  await fulfillmentRequestWorkflow(scope as any, {
    order_id: orderId,
    fulfillment_attempt: attempt,
    correlation_id: input.correlation_id,
  })

  await emitOpsActionExecuted(scope, {
    correlation_id: input.correlation_id,
    actor_id: input.actor_id,
    order_id: orderId,
    action: "retry-fulfillment",
    status: "applied",
    details: {
      fulfillment_attempt: attempt,
    },
  })

  return {
    order_id: orderId,
    status: "applied",
    fulfillment_attempt: attempt,
  }
}

export async function rebuildShipmentContractActionWorkflow(
  scope: ScopeLike,
  input: RebuildShipmentContractActionInput
): Promise<RebuildShipmentContractActionResult> {
  const orderId = normalizeOrderId(input.order_id ?? "")
  if (!orderId) {
    throw new OpsActionWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  setCorrelationContext({
    correlation_id: input.correlation_id,
    workflow_name: "ops_rebuild_shipment_contract_action",
    order_id: orderId,
  })
  logStructured(scope as any, "info", "Executing rebuild shipment contract action", {
    workflow_name: "ops_rebuild_shipment_contract_action",
    step_name: "start",
    order_id: orderId,
  })

  let order = await getOrder(scope, orderId)
  let intents = getFulfillmentIntents(order.metadata)
  let latest = getLatestIntent(intents)

  if (!latest) {
    await fulfillmentRequestWorkflow(scope as any, {
      order_id: orderId,
      fulfillment_attempt: 1,
      correlation_id: input.correlation_id,
    })
    order = await getOrder(scope, orderId)
    intents = getFulfillmentIntents(order.metadata)
    latest = getLatestIntent(intents)
    if (!latest) {
      throw new OpsActionWorkflowError(
        "FULFILLMENT_INTENT_NOT_FOUND",
        `Unable to create fulfillment intent for order ${orderId}.`
      )
    }
  }

  const contract = buildShipmentContract(order)
  const nextSummary = buildShipmentContractSummary(contract)
  const currentSummary = latest.intent.shipment_contract_summary
  const noChanges = summariesEqual(currentSummary, nextSummary)

  if (noChanges) {
    await emitOpsActionExecuted(scope, {
      correlation_id: input.correlation_id,
      actor_id: input.actor_id,
      order_id: orderId,
      action: "rebuild-shipment-contract",
      status: "noop",
      details: {
        fulfillment_attempt: latest.attempt,
        reason: "shipment_contract_summary_unchanged",
      },
    })

    return {
      order_id: orderId,
      status: "noop",
      fulfillment_attempt: latest.attempt,
    }
  }

  const metadata =
    order.metadata && typeof order.metadata === "object" ? order.metadata : {}
  const updatedIntents = {
    ...intents,
    [latest.key]: {
      ...latest.intent,
      shipment_contract_summary: nextSummary,
      updated_at: parseDateLike(new Date().toISOString()),
    },
  }

  const orderModule = scope.resolve(Modules.ORDER)
  await orderModule.updateOrders(order.id, {
    metadata: {
      ...metadata,
      fulfillment_intents_v1: updatedIntents,
    },
  })

  await emitOpsActionExecuted(scope, {
    correlation_id: input.correlation_id,
    actor_id: input.actor_id,
    order_id: orderId,
    action: "rebuild-shipment-contract",
    status: "applied",
    details: {
      fulfillment_attempt: latest.attempt,
    },
  })

  return {
    order_id: orderId,
    status: "applied",
    fulfillment_attempt: latest.attempt,
  }
}

export async function markCodCapturedActionWorkflow(
  scope: ScopeLike,
  input: MarkCodCapturedActionInput
): Promise<MarkCodCapturedActionResult> {
  const orderId = normalizeOrderId(input.order_id ?? "")
  if (!orderId) {
    throw new OpsActionWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const result = await captureCodPaymentWorkflow(scope as any, {
    order_id: orderId,
    actor_id: input.actor_id,
    correlation_id: input.correlation_id,
  })

  const status: ActionStatus = result.already_captured ? "noop" : "applied"
  await emitOpsActionExecuted(scope, {
    correlation_id: input.correlation_id,
    actor_id: input.actor_id,
    order_id: orderId,
    action: "mark-cod-captured",
    status,
    details: {
      payment_id: result.payment_id,
    },
  })

  return {
    order_id: orderId,
    status,
    payment_id: result.payment_id,
  }
}

export async function recordCodRefundActionWorkflow(
  scope: ScopeLike,
  input: RecordCodRefundActionInput
): Promise<RecordCodRefundActionResult> {
  const orderId = normalizeOrderId(input.order_id ?? "")
  if (!orderId) {
    throw new OpsActionWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
  }

  const result = await recordCodRefundWorkflow(scope as any, {
    order_id: orderId,
    amount: input.amount,
    reason: input.reason,
    actor_id: input.actor_id,
    correlation_id: input.correlation_id,
  })

  const status: ActionStatus = result.already_recorded ? "noop" : "applied"
  await emitOpsActionExecuted(scope, {
    correlation_id: input.correlation_id,
    actor_id: input.actor_id,
    order_id: orderId,
    action: "record-cod-refund",
    status,
    details: {
      payment_id: result.payment_id,
      amount: input.amount,
      reason: input.reason,
    },
  })

  return {
    order_id: orderId,
    status,
    payment_id: result.payment_id,
  }
}
