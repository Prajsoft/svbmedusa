import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  buildShipmentContract,
  type ShipmentContract,
} from "../modules/shipping/build-shipment-contract"
import {
  ShipmentLabelStatus,
  type ShippingPersistenceRepository,
} from "../modules/shipping/shipment-persistence"
import { createShippingProviderRouter } from "../modules/shipping/provider-router"
import { emitBusinessEvent } from "../modules/logging/business-events"
import {
  resolveCorrelationId,
  setCorrelationContext,
} from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"

type ScopeLike = {
  resolve: (key: string) => any
}

type OrderLike = {
  id: string
  display_id?: number | string | null
  currency_code?: string | null
  email?: string | null
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

type FulfillmentRequestedDependencies = {
  loadOrder: (scope: ScopeLike, orderId: string) => Promise<OrderLike>
  buildContract: (order: OrderLike) => ShipmentContract
  createRouter: (
    scope: ScopeLike
  ) => {
    repository: ShippingPersistenceRepository
    router: ReturnType<typeof createShippingProviderRouter>["router"]
  }
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toUpperCurrency(value: unknown): string {
  const normalized = readText(value).toUpperCase()
  return normalized || "INR"
}

function readBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value
  }

  const normalized = readText(value).toLowerCase()
  if (!normalized) {
    return fallback
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false
  }

  return fallback
}

function toPositiveInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const floored = Math.floor(value)
    return floored > 0 ? floored : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      const floored = Math.floor(parsed)
      return floored > 0 ? floored : 0
    }
  }

  return 0
}

function parseLatestFulfillmentAttempt(order: OrderLike): number {
  const intentsRaw = order.metadata?.fulfillment_intents_v1
  if (!intentsRaw || typeof intentsRaw !== "object" || Array.isArray(intentsRaw)) {
    return 1
  }

  let latestAttempt = 1
  for (const [key, value] of Object.entries(intentsRaw as Record<string, unknown>)) {
    const fromRecord = toPositiveInt(
      value && typeof value === "object"
        ? (value as Record<string, unknown>).fulfillment_attempt
        : null
    )
    if (fromRecord > latestAttempt) {
      latestAttempt = fromRecord
      continue
    }

    const match = key.match(/:(\d+)$/)
    if (match) {
      const parsed = toPositiveInt(match[1])
      if (parsed > latestAttempt) {
        latestAttempt = parsed
      }
    }
  }

  return latestAttempt
}

function buildInternalReference(order: OrderLike): string {
  const attempt = parseLatestFulfillmentAttempt(order)
  return `ship_${order.id}_${attempt}`
}

function mapAddress(
  input: ShipmentContract["pickup_address"],
  email?: string | null
) {
  return {
    name: input.name,
    phone: input.phone,
    email: readText(email) || undefined,
    line1: input.line1,
    line2: input.line2,
    city: input.city,
    state: input.state,
    postal_code: input.postal_code,
    country_code: input.country_code,
  }
}

function mapLineItems(contract: ShipmentContract) {
  const merged = new Map<string, { sku: string; name: string; qty: number }>()
  for (const pkg of contract.packages) {
    for (const item of pkg.items) {
      const key = `${item.sku}::${item.name}`
      const existing = merged.get(key)
      if (existing) {
        existing.qty += toPositiveInt(item.qty) || 0
        continue
      }
      merged.set(key, {
        sku: item.sku,
        name: item.name,
        qty: toPositiveInt(item.qty) || 1,
      })
    }
  }

  return Array.from(merged.values())
}

function defaultLoadOrder(scope: ScopeLike, orderId: string): Promise<OrderLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  return query
    .graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "currency_code",
        "email",
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
    .then((result: { data?: unknown }) => {
      const order = Array.isArray(result.data)
        ? (result.data[0] as OrderLike | undefined)
        : (result.data as OrderLike | undefined)

      if (!order) {
        throw new Error(`Order not found for fulfillment.requested: ${orderId}`)
      }

      return order
    })
}

export function createFulfillmentRequestedHandler(
  dependencies?: Partial<FulfillmentRequestedDependencies>
) {
  const deps: FulfillmentRequestedDependencies = {
    loadOrder: defaultLoadOrder,
    buildContract: buildShipmentContract,
    createRouter: (scope: ScopeLike) => createShippingProviderRouter(scope),
    ...dependencies,
  }

  return async function fulfillmentRequestedSubscriber({
    event,
    container,
  }: SubscriberArgs<Record<string, unknown>>) {
    const data = (event?.data ?? {}) as Record<string, unknown>
    const orderId = readText(data.order_id ?? data.id)
    const correlationId = resolveCorrelationId(
      readText(data.correlation_id) || undefined
    )

    if (!orderId) {
      return
    }

    setCorrelationContext({
      correlation_id: correlationId,
      workflow_name: "subscriber_fulfillment_requested",
      step_name: "start",
      order_id: orderId,
    })

    const { repository, router } = deps.createRouter(container as any)
    try {
      if (!readBool(process.env.SHIPPING_BOOKING_ENABLED, true)) {
        logStructured(container as any, "info", "shipping booking disabled; skipping fulfillment.requested", {
          workflow_name: "subscriber_fulfillment_requested",
          step_name: "booking_disabled",
          order_id: orderId,
        })
        return
      }

      const provider = router.getDefaultProviderId(correlationId)
      const existingShipments = await repository.listActiveShipments(orderId, provider)
      if (existingShipments.length > 0) {
        logStructured(container as any, "info", "shipping booking skipped; active shipment exists", {
          workflow_name: "subscriber_fulfillment_requested",
          step_name: "dedupe",
          order_id: orderId,
          meta: {
            shipment_id: existingShipments[0].id,
            provider,
          },
        })
        return
      }

      const order = await deps.loadOrder(container as any, orderId)
      const contract = deps.buildContract(order)
      const internalReference = buildInternalReference(order)

      const draftShipment = await repository.createShipment({
        order_id: order.id,
        provider,
        internal_reference: internalReference,
        status: "BOOKING_IN_PROGRESS",
        is_active: true,
        label_status: ShipmentLabelStatus.MISSING,
        replay_buffered_events: false,
      })

      const created = await router.createShipment({
        provider,
        correlation_id: correlationId,
        request: {
          internal_reference: internalReference,
          idempotency_key: internalReference,
          correlation_id: correlationId,
          order_reference: contract.invoice_ref || String(order.display_id ?? order.id),
          currency_code: toUpperCurrency(order.currency_code),
          pickup_address: mapAddress(contract.pickup_address, order.email),
          delivery_address: mapAddress(contract.delivery_address, order.email),
          parcels: contract.packages.map((pkg) => ({
            weight_grams: pkg.weight_grams,
            dimensions_cm: pkg.dimensions_cm,
          })),
          line_items: mapLineItems(contract),
          cod: {
            enabled: contract.cod.enabled,
            amount: contract.cod.amount,
          },
          notes: contract.notes,
          metadata: {
            order_id: order.id,
          },
        },
      })

      const updated = await repository.markShipmentBookedFromProvider({
        shipment_id: draftShipment.id,
        provider_order_id:
          readText((created.metadata as Record<string, unknown> | undefined)?.provider_order_id) ||
          internalReference,
        provider_shipment_id: created.shipment_id,
        provider_awb: created.tracking_number ?? null,
        status: created.status,
        label_url: created.label?.label_url ?? null,
        label_generated_at: created.booked_at ?? new Date(),
        label_expires_at: created.label?.label_expires_at ?? null,
        label_last_fetched_at: new Date(),
        label_status: created.label?.label_url
          ? ShipmentLabelStatus.AVAILABLE
          : ShipmentLabelStatus.MISSING,
      })

      if (updated) {
        await repository.replayBufferedEventsForShipment(updated)
      }

      await emitBusinessEvent(container as any, {
        name: "shipping.shipment_booked",
        correlation_id: correlationId,
        workflow_name: "subscriber_fulfillment_requested",
        step_name: "book_shipment",
        order_id: order.id,
        data: {
          order_id: order.id,
          shipment_id: updated?.id ?? draftShipment.id,
          provider,
          provider_shipment_id: updated?.provider_shipment_id ?? created.shipment_id,
        },
      })
    } catch (error) {
      const errorCode =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? ((error as { code: string }).code as string)
          : "SHIPPING_BOOKING_FAILED"

      logStructured(container as any, "error", "shipping booking failed for fulfillment.requested", {
        workflow_name: "subscriber_fulfillment_requested",
        step_name: "book_shipment",
        order_id: orderId,
        error_code: errorCode,
        meta: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })

      await emitBusinessEvent(container as any, {
        name: "shipping.shipment_booking_failed",
        correlation_id: correlationId,
        workflow_name: "subscriber_fulfillment_requested",
        step_name: "book_shipment",
        order_id: orderId,
        data: {
          order_id: orderId,
          error_code: errorCode,
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })

      if (errorCode === "BOOKING_DISABLED") {
        return
      }

      throw error
    }
  }
}

export default createFulfillmentRequestedHandler()

export const config: SubscriberConfig = {
  event: "fulfillment.requested",
}
