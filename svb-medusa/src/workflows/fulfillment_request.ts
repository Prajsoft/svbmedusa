import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  buildShipmentContract,
  type ShipmentContract,
  ShipmentContractBuildError,
} from "../modules/shipping/build-shipment-contract"
import { emitBusinessEvent } from "../modules/logging/business-events"
import { setCorrelationContext } from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"
import { increment, observeDuration } from "../modules/observability/metrics"

type ScopeLike = {
  resolve: (key: string) => any
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

type FulfillmentIntentRecord = {
  idempotency_key: string
  fulfillment_attempt: number
  state: "requested"
  requested_at: string
  shipment_contract_summary: ShipmentContractSummary
}

export type FulfillmentRequestWorkflowInput = {
  order_id: string
  fulfillment_attempt?: number
  correlation_id?: string
}

export type FulfillmentRequestWorkflowResult = {
  order_id: string
  idempotency_key: string
  created: boolean
  shipment_contract_summary: ShipmentContractSummary
}

export class FulfillmentRequestError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "FulfillmentRequestError"
    this.code = code
  }
}

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

function nowMs(): number {
  return Date.now()
}

function extractErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code.trim()
    return code || undefined
  }

  return undefined
}

function normalizeAttempt(value?: number): number {
  const parsed = Math.floor(toNumber(value))
  return parsed > 0 ? parsed : 1
}

function getIdempotencyKey(orderId: string, fulfillmentAttempt: number): string {
  return `${orderId}:${fulfillmentAttempt}`
}

function buildShipmentContractSummary(
  shipmentContract: ShipmentContract
): ShipmentContractSummary {
  const totalWeight = shipmentContract.packages.reduce(
    (sum, pkg) => sum + toNumber(pkg.weight_grams),
    0
  )

  return {
    pickup_location_code: shipmentContract.pickup_location_code,
    package_count: shipmentContract.packages.length,
    total_weight_grams: Math.round(totalWeight * 100) / 100,
    cod: {
      enabled: shipmentContract.cod.enabled,
      amount: shipmentContract.cod.amount,
    },
    invoice_ref: shipmentContract.invoice_ref,
  }
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

  const order = first<OrderLike>(data)
  if (!order) {
    throw new FulfillmentRequestError(
      "ORDER_NOT_FOUND",
      `Order ${orderId} was not found.`
    )
  }

  return order
}

function assertOrderFulfillable(order: OrderLike): void {
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new FulfillmentRequestError(
      "ORDER_NOT_FULFILLABLE",
      `Order ${order.id} has no items to fulfill.`
    )
  }

  if (!order.shipping_address) {
    throw new FulfillmentRequestError(
      "ORDER_NOT_FULFILLABLE",
      `Order ${order.id} is missing a shipping address.`
    )
  }
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

function buildUpdatedOrderMetadata(
  order: OrderLike,
  idempotencyKey: string,
  intentRecord: FulfillmentIntentRecord
): Record<string, unknown> {
  const currentMetadata =
    order.metadata && typeof order.metadata === "object" ? order.metadata : {}
  const intents = getFulfillmentIntents(currentMetadata)

  return {
    ...currentMetadata,
    fulfillment_state_v1: "requested",
    fulfillment_intents_v1: {
      ...intents,
      [idempotencyKey]: intentRecord,
    },
  }
}

export async function fulfillmentRequestWorkflow(
  scope: ScopeLike,
  input: FulfillmentRequestWorkflowInput
): Promise<FulfillmentRequestWorkflowResult> {
  const startedAt = nowMs()
  let outcome: "success" | "failure" = "failure"
  let failureCode: string | undefined
  let orderId = input.order_id?.trim() || ""

  try {
    if (!orderId) {
      throw new FulfillmentRequestError("ORDER_ID_REQUIRED", "order_id is required.")
    }

    const fulfillmentAttempt = normalizeAttempt(input.fulfillment_attempt)
    const idempotencyKey = getIdempotencyKey(orderId, fulfillmentAttempt)

    setCorrelationContext({
      correlation_id: input.correlation_id,
      workflow_name: "fulfillment_request",
      order_id: orderId,
    })
    logStructured(scope as any, "info", "Building fulfillment request", {
      workflow_name: "fulfillment_request",
      step_name: "start",
      order_id: orderId,
    })

    const order = await getOrder(scope, orderId)
    const existingIntent = getFulfillmentIntents(order.metadata)[idempotencyKey]

    if (existingIntent) {
      outcome = "success"
      return {
        order_id: order.id,
        idempotency_key: idempotencyKey,
        created: false,
        shipment_contract_summary: existingIntent.shipment_contract_summary,
      }
    }

    assertOrderFulfillable(order)

    let shipmentContract: ShipmentContract
    try {
      shipmentContract = buildShipmentContract(order)
    } catch (error) {
      if (
        error instanceof FulfillmentRequestError ||
        error instanceof ShipmentContractBuildError ||
        (error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "MISSING_LOGISTICS_METADATA")
      ) {
        throw error
      }

      throw new FulfillmentRequestError(
        "FULFILLMENT_CONTRACT_BUILD_FAILED",
        `Failed to build shipment contract for order ${order.id}.`
      )
    }

    const shipmentContractSummary = buildShipmentContractSummary(shipmentContract)
    const now = new Date().toISOString()
    const intentRecord: FulfillmentIntentRecord = {
      idempotency_key: idempotencyKey,
      fulfillment_attempt: fulfillmentAttempt,
      state: "requested",
      requested_at: now,
      shipment_contract_summary: shipmentContractSummary,
    }

    const orderModule = scope.resolve(Modules.ORDER)
    await orderModule.updateOrders(order.id, {
      metadata: buildUpdatedOrderMetadata(order, idempotencyKey, intentRecord),
    })

    await emitBusinessEvent(scope as any, {
      name: "fulfillment.requested",
      correlation_id: input.correlation_id,
      workflow_name: "fulfillment_request",
      step_name: "emit_event",
      order_id: order.id,
      data: {
        order_id: order.id,
        shipment_contract_summary: shipmentContractSummary,
      },
    })

    outcome = "success"
    return {
      order_id: order.id,
      idempotency_key: idempotencyKey,
      created: true,
      shipment_contract_summary: shipmentContractSummary,
    }
  } catch (error) {
    failureCode = extractErrorCode(error)
    throw error
  } finally {
    const labels = {
      workflow: "fulfillment_request",
      result: outcome,
      ...(orderId ? { order_id: orderId } : {}),
      ...(failureCode ? { error_code: failureCode } : {}),
    }

    observeDuration(
      "workflow.fulfillment_request.duration_ms",
      nowMs() - startedAt,
      labels
    )
    increment(
      `workflow.fulfillment_request.${outcome}_total`,
      labels
    )
  }
}
