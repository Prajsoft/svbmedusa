import crypto from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CORRELATION_ID_HEADER,
  extractCorrelationIdFromRequest,
} from "../../../../modules/logging/correlation"
import { logEvent } from "../../../../modules/logging/log-event"
import { processCarrierWebhook } from "../../../../modules/shipping/webhook-pipeline"
import { ShippingPersistenceRepository } from "../../../../modules/shipping/shipment-persistence"
import {
  ProviderErrorCode,
  ShipmentStatus,
  ShippingProviderError,
} from "../../../../integrations/carriers/provider-contract"
import { mapShiprocketStatus } from "../../../../integrations/carriers/shiprocket"
import { shouldAllowUnsignedShippingWebhooks } from "../../../../modules/shipping/webhook-security-policy"

type PgConnectionLike = {
  raw: (query: string, bindings?: unknown[]) => Promise<{
    rows?: Array<Record<string, unknown>>
  }>
}

type ShiprocketWebhookPayload = {
  provider_event_id: string
  provider_shipment_id?: string
  provider_awb?: string
  internal_reference?: string
  provider_order_id?: string
  event_type: string
  status?: ShipmentStatus
  payload: Record<string, unknown>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function firstNonEmpty(values: unknown[]): string {
  for (const value of values) {
    const normalized =
      typeof value === "number" && Number.isFinite(value)
        ? String(Math.floor(value))
        : typeof value === "boolean"
          ? String(value)
          : readText(value)
    if (normalized) {
      return normalized
    }
  }
  return ""
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const target = readText(name).toLowerCase()
  if (!target) {
    return ""
  }

  for (const [key, raw] of Object.entries(headers ?? {})) {
    if (readText(key).toLowerCase() !== target) {
      continue
    }

    if (Array.isArray(raw)) {
      return readText(raw[0])
    }

    return readText(raw)
  }

  return ""
}

function getNestedRecord(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  return toRecord(record[key])
}

function constantTimeEqual(leftInput: string, rightInput: string): boolean {
  const left = readText(leftInput)
  const right = readText(rightInput)
  if (!left || !right) {
    return false
  }

  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function verifyShiprocketWebhookToken(input: {
  headers: Record<string, string | string[] | undefined>
  env?: NodeJS.ProcessEnv
}): boolean {
  const env = input.env ?? process.env
  const expected = readText(env.SHIPROCKET_WEBHOOK_TOKEN)
  const provided = readHeader(input.headers ?? {}, "anx-api-key")
  return constantTimeEqual(expected, provided)
}

function getRawBody(req: MedusaRequest): string {
  if (Buffer.isBuffer((req as any).rawBody)) {
    return ((req as any).rawBody as Buffer).toString("utf8")
  }

  if (typeof (req as any).rawBody === "string") {
    return (req as any).rawBody
  }

  return JSON.stringify(req.body ?? {})
}

function mapShiprocketStatusIdToNormalized(
  statusIdInput: unknown
): ShipmentStatus | null {
  const raw = readText(statusIdInput)
  if (!raw) {
    return null
  }

  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) {
    return null
  }

  const statusId = Math.floor(numeric)
  switch (statusId) {
    case 1:
      return "BOOKED"
    case 2:
    case 3:
    case 4:
    case 5:
      return "PICKUP_SCHEDULED"
    case 6:
      return "IN_TRANSIT"
    case 7:
      return "DELIVERED"
    case 8:
      return "CANCELLED"
    case 9:
      return "RTO_INITIATED"
    case 10:
      return "RTO_IN_TRANSIT"
    case 11:
      return "RTO_DELIVERED"
    case 12:
      return "FAILED"
    default:
      return null
  }
}

function normalizeWebhookStatus(input: {
  payload: Record<string, unknown>
  data: Record<string, unknown>
  shipment: Record<string, unknown>
  shipmentDetails: Record<string, unknown>
}): {
  event_type: string
  status: ShipmentStatus | undefined
} {
  const statusText = firstNonEmpty([
    input.payload.current_status,
    input.payload.status,
    input.payload.shipment_status,
    input.data.current_status,
    input.data.status,
    input.data.shipment_status,
    input.shipment.current_status,
    input.shipment.status,
    input.shipment.shipment_status,
    input.shipmentDetails.current_status,
    input.shipmentDetails.status,
    input.shipmentDetails.shipment_status,
  ])

  let normalizedStatus: ShipmentStatus | undefined
  if (statusText) {
    normalizedStatus = mapShiprocketStatus(statusText)
  }

  if (!normalizedStatus) {
    const byStatusId = mapShiprocketStatusIdToNormalized(
      firstNonEmpty([
        input.payload.current_status_id,
        input.payload.shipment_status_id,
        input.data.current_status_id,
        input.data.shipment_status_id,
        input.shipment.current_status_id,
        input.shipment.shipment_status_id,
        input.shipmentDetails.current_status_id,
        input.shipmentDetails.shipment_status_id,
      ])
    )
    if (byStatusId) {
      normalizedStatus = byStatusId
    }
  }

  const eventTypeFromPayload =
    firstNonEmpty([
      input.payload.event,
      input.payload.event_type,
      input.payload.type,
      input.data.event,
      input.data.event_type,
      input.data.type,
      statusText,
    ]) || "shiprocket.webhook"

  const eventType =
    normalizedStatus?.toLowerCase() || eventTypeFromPayload.toLowerCase()

  return {
    event_type: eventType,
    status: normalizedStatus,
  }
}

function deriveProviderEventId(input: {
  provider_awb: string
  current_timestamp: string
  current_status_id: string
  shipment_status_id: string
  raw_body: string
}): string {
  const seed =
    `${readText(input.provider_awb)}|${readText(input.current_timestamp)}|` +
    `${readText(input.current_status_id)}|${readText(input.shipment_status_id)}`
  const material = seed === "|||" ? input.raw_body : seed
  const digest = crypto.createHash("sha256").update(material).digest("hex")
  return `srwh_${digest}`
}

function normalizeShiprocketWebhook(input: {
  body: unknown
  headers: Record<string, string | string[] | undefined>
  raw_body: string
}): ShiprocketWebhookPayload {
  const payload = toRecord(input.body)
  const data = getNestedRecord(payload, "data")
  const shipment = getNestedRecord(data, "shipment")
  const shipmentDetails = getNestedRecord(data, "shipment_details")

  const providerShipmentId = firstNonEmpty([
    payload.shipment_id,
    payload.shipmentId,
    data.shipment_id,
    data.shipmentId,
    shipment.shipment_id,
    shipment.shipmentId,
    shipment.id,
    shipmentDetails.shipment_id,
    shipmentDetails.shipmentId,
  ])

  const providerAwb = firstNonEmpty([
    payload.awb,
    payload.awb_code,
    payload.tracking_number,
    data.awb,
    data.awb_code,
    data.tracking_number,
    shipment.awb,
    shipment.awb_code,
    shipment.tracking_number,
    shipmentDetails.awb,
    shipmentDetails.awb_code,
  ])

  const internalReference = firstNonEmpty([
    payload.order_id,
    payload.orderId,
    data.order_id,
    data.orderId,
    shipment.order_id,
    shipment.orderId,
    shipmentDetails.order_id,
    shipmentDetails.orderId,
  ])

  const providerOrderId = firstNonEmpty([
    payload.sr_order_id,
    payload.shiprocket_order_id,
    data.sr_order_id,
    data.shiprocket_order_id,
    shipment.sr_order_id,
    shipment.shiprocket_order_id,
    shipmentDetails.sr_order_id,
    shipmentDetails.shiprocket_order_id,
  ])

  const currentTimestamp = firstNonEmpty([
    payload.current_timestamp,
    data.current_timestamp,
    shipment.current_timestamp,
    shipmentDetails.current_timestamp,
    payload.current_status_datetime,
    data.current_status_datetime,
    payload.updated_at,
    data.updated_at,
  ])

  const currentStatusId = firstNonEmpty([
    payload.current_status_id,
    data.current_status_id,
    shipment.current_status_id,
    shipmentDetails.current_status_id,
  ])

  const shipmentStatusId = firstNonEmpty([
    payload.shipment_status_id,
    data.shipment_status_id,
    shipment.shipment_status_id,
    shipmentDetails.shipment_status_id,
  ])

  const providerEventId = deriveProviderEventId({
    provider_awb: providerAwb,
    current_timestamp: currentTimestamp,
    current_status_id: currentStatusId,
    shipment_status_id: shipmentStatusId,
    raw_body: input.raw_body,
  })

  const statusSignals = normalizeWebhookStatus({
    payload,
    data,
    shipment,
    shipmentDetails,
  })

  return {
    provider_event_id: providerEventId,
    provider_shipment_id: providerShipmentId || undefined,
    provider_awb: providerAwb || undefined,
    internal_reference: internalReference || undefined,
    provider_order_id: providerOrderId || undefined,
    event_type: statusSignals.event_type,
    status: statusSignals.status,
    payload,
  }
}

function mapProviderErrorStatus(code: string): number {
  const normalized = readText(code).toUpperCase()
  switch (normalized) {
    case ProviderErrorCode.AUTH_FAILED:
    case ProviderErrorCode.SIGNATURE_INVALID:
      return 401
    case ProviderErrorCode.RATE_LIMITED:
      return 429
    case ProviderErrorCode.SERVICEABILITY_FAILED:
    case ProviderErrorCode.INVALID_ADDRESS:
    case ProviderErrorCode.NOT_SUPPORTED:
      return 400
    case ProviderErrorCode.BOOKING_DISABLED:
    case ProviderErrorCode.PROVIDER_UNAVAILABLE:
      return 503
    case ProviderErrorCode.UPSTREAM_ERROR:
    default:
      return 500
  }
}

function normalizeError(
  error: unknown,
  correlationId: string
): {
  status: number
  body: {
    error: {
      code: string
      message: string
      details: Record<string, unknown>
      correlation_id: string
    }
  }
} {
  if (error instanceof ShippingProviderError) {
    return {
      status: mapProviderErrorStatus(error.code),
      body: error.toErrorEnvelope(),
    }
  }

  return {
    status: 500,
    body: {
      error: {
        code: ProviderErrorCode.UPSTREAM_ERROR,
        message:
          error instanceof Error
            ? error.message
            : "Shipping webhook processing failed.",
        details: {},
        correlation_id: correlationId,
      },
    },
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const correlationId = extractCorrelationIdFromRequest(req as any)
  ;(req as any).correlation_id = correlationId

  if (typeof (res as any).setHeader === "function") {
    ;(res as any).setHeader(CORRELATION_ID_HEADER, correlationId)
  }

  const rawBody = getRawBody(req)
  const body = toRecord(req.body ?? {})
  const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>

  try {
    const scope = (req as any).scope
    const pgConnection = scope?.resolve?.(
      ContainerRegistrationKeys.PG_CONNECTION
    ) as PgConnectionLike

    if (!pgConnection || typeof pgConnection.raw !== "function") {
      throw new ShippingProviderError({
        code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
        message: "PG connection is unavailable for shipping webhook processing.",
        correlation_id: correlationId,
        details: {},
      })
    }

    const repository = new ShippingPersistenceRepository(pgConnection)
    const normalized = normalizeShiprocketWebhook({
      body,
      headers,
      raw_body: rawBody,
    })
    const verified = verifyShiprocketWebhookToken({
      headers,
      env: process.env,
    })
    const allowUnsigned = shouldAllowUnsignedShippingWebhooks()
    const acceptedWithDegradedSecurity = !verified && allowUnsigned

    if (!verified && !acceptedWithDegradedSecurity) {
      throw new ShippingProviderError({
        code: ProviderErrorCode.SIGNATURE_INVALID,
        message: "Invalid shipping webhook token.",
        correlation_id: correlationId,
        details: {
          provider: "shiprocket",
          provider_event_id: normalized.provider_event_id,
        },
      })
    }

    if (acceptedWithDegradedSecurity) {
      normalized.payload = {
        ...normalized.payload,
        webhook_security: "degraded",
        security_mode: "allow_unsigned_webhooks_override",
        security_reason: "verification_failed_but_override_enabled",
      }
    }

    const result = await processCarrierWebhook({
      provider: "shiprocket",
      provider_event_id: normalized.provider_event_id,
      provider_shipment_id: normalized.provider_shipment_id,
      provider_awb: normalized.provider_awb,
      internal_reference: normalized.internal_reference,
      provider_order_id: normalized.provider_order_id,
      event_type: normalized.event_type,
      status: normalized.status,
      payload: normalized.payload,
      headers,
      raw_body: rawBody,
      correlation_id: correlationId,
      repository,
      verify_signature: () => true,
    })

    if (acceptedWithDegradedSecurity) {
      logEvent(
        "WEBHOOK_SECURITY_DEGRADED",
        {
          provider: "shiprocket",
          event_id: normalized.provider_event_id,
          request_id: readText((req as any).id) || null,
          reason: "ALLOW_UNSIGNED_WEBHOOKS enabled while verification failed",
        },
        correlationId,
        {
          level: "warn",
          scopeOrLogger: (req as any).scope,
        }
      )
    }

    logEvent(
      "SHIPPING_WEBHOOK_RECEIVED",
      {
        provider: "shiprocket",
        event_id: normalized.provider_event_id,
        event_type: normalized.event_type,
        matched: result.matched,
        deduped: result.deduped,
        buffered: result.buffered,
        processed: result.processed,
        shipment_id: result.shipment_id,
      },
      correlationId,
      {
        level: "info",
        scopeOrLogger: (req as any).scope,
      }
    )

    res.status(200).json({
      ok: true,
      provider: "shiprocket",
      event_id: normalized.provider_event_id,
      event_type: normalized.event_type,
      processed: result.processed,
      deduped: result.deduped,
      buffered: result.buffered,
      matched: result.matched,
      shipment_id: result.shipment_id,
      status_updated: result.status_updated,
      security_mode: acceptedWithDegradedSecurity ? "degraded" : "verified",
      correlation_id: correlationId,
    })
  } catch (error) {
    const normalizedError = normalizeError(error, correlationId)

    logEvent(
      "SHIPPING_WEBHOOK_FAILED",
      {
        provider: "shiprocket",
        request_id: readText((req as any).id) || null,
        error_code: normalizedError.body.error.code,
        error_message: normalizedError.body.error.message,
      },
      correlationId,
      {
        level: "error",
        scopeOrLogger: (req as any).scope,
      }
    )

    res.status(normalizedError.status).json(normalizedError.body)
  }
}
