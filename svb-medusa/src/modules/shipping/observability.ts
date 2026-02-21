import { logEvent } from "../logging/log-event"

type LogLevel = "debug" | "info" | "warn" | "error"

type LogOptions = {
  scopeOrLogger?: unknown
  level?: LogLevel
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toPositiveInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 0 ? 0 : Math.round(value)
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed < 0 ? 0 : Math.round(parsed)
    }
  }

  return 0
}

function readBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value
  }

  const normalized = readText(value).toLowerCase()
  return ["true", "1", "yes", "on"].includes(normalized)
}

function normalizeErrorCode(value: unknown): string | null {
  const normalized = readText(value).toUpperCase()
  return normalized || null
}

export function logProviderCall(
  input: {
    provider: string
    method: string
    duration_ms: number
    success: boolean
    error_code?: string | null
    correlation_id: string
    shipment_id?: string
    provider_shipment_id?: string
  },
  options: LogOptions = {}
): Record<string, unknown> {
  const provider = readText(input.provider).toLowerCase() || "unknown"
  const method = readText(input.method).toLowerCase() || "unknown"
  const durationMs = toPositiveInt(input.duration_ms)
  const success = readBool(input.success)
  const errorCode = normalizeErrorCode(input.error_code)
  const correlationId = readText(input.correlation_id)
  const shipmentId = readText(input.shipment_id) || null
  const providerShipmentId = readText(input.provider_shipment_id) || null

  return logEvent(
    "SHIPPING_PROVIDER_CALL",
    {
      provider,
      method,
      duration_ms: durationMs,
      success,
      error_code: errorCode,
      shipment_id: shipmentId,
      provider_shipment_id: providerShipmentId,
    },
    correlationId,
    {
      level: options.level ?? (success ? "info" : "error"),
      scopeOrLogger: options.scopeOrLogger,
    }
  )
}
