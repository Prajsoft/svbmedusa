import type { ShipmentStatus } from "../../integrations/carriers/provider-contract"
import { ShippingProviderError } from "../../integrations/carriers/provider-contract"
import { resolveCorrelationId, setCorrelationContext } from "../logging/correlation"
import { logStructured } from "../logging/structured-logger"
import {
  createShippingProviderRouter,
  getShippingPersistenceRepository,
} from "./provider-router"
import {
  ShipmentLabelStatus,
  type ShippingPersistenceRepository,
} from "./shipment-persistence"

type ScopeLike = {
  resolve: (key: string) => any
}

type ResolveShipmentLabelInput = {
  shipment_id: string
  correlation_id?: string
}

type ResolveShipmentLabelResult = {
  shipment_id: string
  provider: string
  provider_shipment_id: string | null
  label_url: string
  label_expires_at: string | null
  label_status: string
  refreshed: boolean
}

type ResolveShipmentLabelDependencies = {
  repository?: ShippingPersistenceRepository
  now?: () => Date
}

export class ShipmentLabelError extends Error {
  code: string
  httpStatus: number

  constructor(code: string, message: string, httpStatus: number) {
    super(message)
    this.name = "ShipmentLabelError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }

  const normalized = readText(value)
  return normalized || null
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value
  }

  const normalized = readText(value)
  if (!normalized) {
    return null
  }

  const parsed = new Date(normalized)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function isLabelExpired(input: {
  label_status?: string | null
  label_expires_at?: Date | string | null
  now: Date
}): boolean {
  const status = readText(input.label_status).toUpperCase()
  if (
    status === ShipmentLabelStatus.EXPIRED ||
    status === ShipmentLabelStatus.MISSING ||
    status === ShipmentLabelStatus.REGEN_REQUIRED
  ) {
    return true
  }

  const expiresAt = parseDate(input.label_expires_at)
  if (!expiresAt) {
    return false
  }

  return input.now.getTime() >= expiresAt.getTime()
}

function assertShipmentId(shipmentIdInput: string): string {
  const shipmentId = readText(shipmentIdInput)
  if (!shipmentId) {
    throw new ShipmentLabelError("SHIPMENT_ID_REQUIRED", "shipment_id is required.", 400)
  }
  return shipmentId
}

function assertProviderShipmentId(input: {
  provider_shipment_id?: string | null
  provider_awb?: string | null
  shipment_id: string
}): string {
  const providerShipmentId =
    readText(input.provider_shipment_id) || readText(input.provider_awb)
  if (!providerShipmentId) {
    throw new ShipmentLabelError(
      "SHIPMENT_PROVIDER_REFERENCE_MISSING",
      `Shipment ${input.shipment_id} is missing provider references.`,
      409
    )
  }
  return providerShipmentId
}

function mapLabelStatus(status: ShipmentStatus | string | undefined): string {
  const normalized = readText(status).toUpperCase()
  return normalized || ShipmentLabelStatus.MISSING
}

export async function resolveShipmentLabel(
  scope: ScopeLike,
  input: ResolveShipmentLabelInput,
  dependencies: ResolveShipmentLabelDependencies = {}
): Promise<ResolveShipmentLabelResult> {
  const now = dependencies.now ? dependencies.now() : new Date()
  const correlationId = resolveCorrelationId(input.correlation_id)
  const shipmentId = assertShipmentId(input.shipment_id)

  setCorrelationContext({
    correlation_id: correlationId,
    workflow_name: "shipment_label",
    step_name: "resolve",
  })

  const repository = getShippingPersistenceRepository(scope, dependencies.repository)
  const shipment = await repository.getShipmentById(shipmentId)
  if (!shipment) {
    throw new ShipmentLabelError(
      "SHIPMENT_NOT_FOUND",
      `Shipment ${shipmentId} was not found.`,
      404
    )
  }

  const labelUrl = readText(shipment.label_url)
  const labelExpired = isLabelExpired({
    label_status: shipment.label_status,
    label_expires_at: shipment.label_expires_at,
    now,
  })

  if (labelUrl && !labelExpired) {
    const touched = await repository.markShipmentBookedFromProvider({
      shipment_id: shipment.id,
      provider_order_id: shipment.provider_order_id,
      provider_shipment_id: shipment.provider_shipment_id,
      provider_awb: shipment.provider_awb,
      status: shipment.status,
      label_url: shipment.label_url,
      label_generated_at: shipment.label_generated_at,
      label_expires_at: shipment.label_expires_at,
      label_last_fetched_at: now,
      label_status: ShipmentLabelStatus.AVAILABLE,
    })

    return {
      shipment_id: shipment.id,
      provider: shipment.provider,
      provider_shipment_id: shipment.provider_shipment_id,
      label_url: readText(touched?.label_url) || labelUrl,
      label_expires_at: toIso(touched?.label_expires_at ?? shipment.label_expires_at),
      label_status: mapLabelStatus(touched?.label_status ?? ShipmentLabelStatus.AVAILABLE),
      refreshed: false,
    }
  }

  const providerShipmentId = assertProviderShipmentId({
    provider_shipment_id: shipment.provider_shipment_id,
    provider_awb: shipment.provider_awb,
    shipment_id: shipment.id,
  })

  const { router } = createShippingProviderRouter(scope, {
    repository,
  })

  try {
    const label = await router.getLabel({
      provider: shipment.provider,
      correlation_id: correlationId,
      request: {
        shipment_id: providerShipmentId,
        regenerate_if_expired: true,
        correlation_id: correlationId,
      },
    })

    const updated = await repository.markShipmentBookedFromProvider({
      shipment_id: shipment.id,
      provider_order_id: shipment.provider_order_id,
      provider_shipment_id: shipment.provider_shipment_id,
      provider_awb: shipment.provider_awb,
      status: shipment.status,
      label_url: label.label_url,
      label_generated_at: now,
      label_expires_at: label.label_expires_at ?? shipment.label_expires_at,
      label_last_fetched_at: now,
      label_status: ShipmentLabelStatus.AVAILABLE,
    })

    return {
      shipment_id: shipment.id,
      provider: shipment.provider,
      provider_shipment_id: shipment.provider_shipment_id,
      label_url: readText(updated?.label_url) || label.label_url,
      label_expires_at: toIso(updated?.label_expires_at ?? label.label_expires_at),
      label_status: mapLabelStatus(updated?.label_status ?? ShipmentLabelStatus.AVAILABLE),
      refreshed: true,
    }
  } catch (error) {
    if (error instanceof ShippingProviderError) {
      if (labelExpired || !labelUrl) {
        await repository.markShipmentBookedFromProvider({
          shipment_id: shipment.id,
          provider_order_id: shipment.provider_order_id,
          provider_shipment_id: shipment.provider_shipment_id,
          provider_awb: shipment.provider_awb,
          status: shipment.status,
          label_url: shipment.label_url,
          label_generated_at: shipment.label_generated_at,
          label_expires_at: shipment.label_expires_at,
          label_last_fetched_at: now,
          label_status: ShipmentLabelStatus.EXPIRED,
        })
      }

      logStructured(scope as any, "error", "Failed to refresh shipment label", {
        workflow_name: "shipment_label",
        step_name: "refresh",
        error_code: error.code,
        meta: {
          shipment_id: shipment.id,
          provider: shipment.provider,
        },
      })
    }

    throw error
  }
}

