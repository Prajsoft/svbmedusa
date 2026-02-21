import { resolveCorrelationId, setCorrelationContext } from "../logging/correlation"
import { emitBusinessEvent } from "../logging/business-events"
import { logStructured } from "../logging/structured-logger"
import { ShipmentLabelStatus } from "./shipment-persistence"
import { createShippingProviderRouter } from "./provider-router"

type ScopeLike = {
  resolve: (key: string) => any
}

type RunShippingBookingRecoveryInput = {
  limit?: number
  older_than_minutes?: number
  correlation_id?: string
}

type RunShippingBookingRecoveryResult = {
  scanned: number
  recovered: number
  unresolved: number
  failed: number
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const floored = Math.floor(value)
    return floored > 0 ? floored : fallback
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      const floored = Math.floor(parsed)
      return floored > 0 ? floored : fallback
    }
  }

  return fallback
}

function getProviderOrderId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const metadata = value as Record<string, unknown>
  return readText(metadata.provider_order_id) || null
}

export async function runShippingBookingRecovery(
  scope: ScopeLike,
  input: RunShippingBookingRecoveryInput = {}
): Promise<RunShippingBookingRecoveryResult> {
  const correlationId = resolveCorrelationId(input.correlation_id)
  setCorrelationContext({
    correlation_id: correlationId,
    workflow_name: "shipping_booking_recovery",
    step_name: "start",
  })

  const { repository, router } = createShippingProviderRouter(scope)
  const limit = toPositiveInt(
    input.limit ?? process.env.SHIPPING_BOOKING_RECOVERY_LIMIT,
    100
  )
  const olderThanMinutes = toPositiveInt(
    input.older_than_minutes ??
      process.env.SHIPPING_BOOKING_RECOVERY_OLDER_THAN_MINUTES,
    10
  )
  const olderThan = new Date(Date.now() - olderThanMinutes * 60 * 1000)
  const stuckShipments = await repository.listStuckBookingInProgress({
    older_than: olderThan,
    limit,
  })

  const result: RunShippingBookingRecoveryResult = {
    scanned: stuckShipments.length,
    recovered: 0,
    unresolved: 0,
    failed: 0,
  }

  for (const shipment of stuckShipments) {
    const internalReference = readText(shipment.internal_reference)
    if (!internalReference) {
      result.unresolved += 1
      continue
    }

    try {
      const providerShipment = await router.lookupShipmentByReference({
        provider: shipment.provider,
        request: {
          internal_reference: internalReference,
          correlation_id: correlationId,
        },
        correlation_id: correlationId,
      })

      if (!providerShipment) {
        result.unresolved += 1
        continue
      }

      const updated = await repository.markShipmentBookedFromProvider({
        shipment_id: shipment.id,
        provider_order_id:
          getProviderOrderId(providerShipment.metadata) ?? internalReference,
        provider_shipment_id: providerShipment.shipment_id,
        provider_awb: providerShipment.tracking_number,
        status: providerShipment.status,
        label_url: providerShipment.label?.label_url ?? null,
        label_generated_at: providerShipment.booked_at ?? new Date(),
        label_expires_at: providerShipment.label?.label_expires_at ?? null,
        label_last_fetched_at: new Date(),
        label_status: providerShipment.label?.label_url
          ? ShipmentLabelStatus.AVAILABLE
          : ShipmentLabelStatus.MISSING,
      })

      if (!updated) {
        result.unresolved += 1
        continue
      }

      await repository.replayBufferedEventsForShipment(updated)
      result.recovered += 1

      await emitBusinessEvent(scope as any, {
        name: "shipping.booking_recovered",
        correlation_id: correlationId,
        workflow_name: "shipping_booking_recovery",
        step_name: "mark_booked",
        order_id: updated.order_id,
        data: {
          shipment_id: updated.id,
          order_id: updated.order_id,
          provider: updated.provider,
          provider_shipment_id: updated.provider_shipment_id,
        },
      })
    } catch (error) {
      result.failed += 1
      logStructured(scope as any, "error", "shipping booking recovery failed", {
        workflow_name: "shipping_booking_recovery",
        step_name: "recover_single",
        error_code:
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? ((error as { code: string }).code as string)
            : "SHIPPING_BOOKING_RECOVERY_FAILED",
        meta: {
          shipment_id: shipment.id,
          provider: shipment.provider,
        },
      })
    }
  }

  logStructured(scope as any, "info", "shipping booking recovery executed", {
    workflow_name: "shipping_booking_recovery",
    step_name: "complete",
    meta: result,
  })

  return result
}

