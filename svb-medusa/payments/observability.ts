import { logEvent } from "../src/modules/logging/log-event"
import {
  increment,
  observeDuration,
  type MetricLabels,
} from "../src/modules/observability/metrics"
import {
  PaymentErrorCode,
  type PaymentErrorCode as PaymentErrorCodeType,
} from "./types"

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

function normalizeErrorCode(value: unknown): PaymentErrorCodeType | null {
  const normalized = readText(value).toUpperCase()
  if (!normalized) {
    return null
  }

  if (normalized in PaymentErrorCode) {
    return PaymentErrorCode[normalized as keyof typeof PaymentErrorCode]
  }

  return null
}

function metricBaseLabels(input: {
  provider: string
  correlation_id: string
  success: boolean
  error_code?: PaymentErrorCodeType | null
}): MetricLabels {
  return {
    provider: readText(input.provider).toLowerCase() || "unknown",
    success: input.success ? "true" : "false",
    error_code: input.error_code ?? undefined,
  }
}

export function logProviderCall(
  input: {
    provider: string
    method: string
    duration_ms: number
    success: boolean
    error_code?: PaymentErrorCodeType | string | null
    correlation_id: string
    payment_id?: string
    payment_session_id?: string
  },
  options: LogOptions = {}
): Record<string, unknown> {
  const provider = readText(input.provider).toLowerCase() || "unknown"
  const method = readText(input.method).toLowerCase() || "unknown"
  const durationMs = toPositiveInt(input.duration_ms)
  const success = readBool(input.success)
  const errorCode = normalizeErrorCode(input.error_code)
  const correlationId = readText(input.correlation_id)
  const paymentId = readText(input.payment_id) || null
  const paymentSessionId = readText(input.payment_session_id) || null

  const payload = logEvent(
    "PAYMENT_PROVIDER_CALL",
    {
      provider,
      method,
      duration_ms: durationMs,
      success,
      error_code: errorCode,
      payment_id: paymentId,
      payment_session_id: paymentSessionId,
    },
    correlationId,
    {
      level: options.level ?? (success ? "info" : "error"),
      scopeOrLogger: options.scopeOrLogger,
    }
  )

  increment("payments.provider.call.total", {
    ...metricBaseLabels({
      provider,
      success,
      correlation_id: correlationId,
      error_code: errorCode,
    }),
    method,
  })
  observeDuration("payments.provider.call.duration_ms", durationMs, {
    provider,
    method,
    success: success ? "true" : "false",
  })

  return payload
}

export function logWebhookEvent(
  input: {
    provider: string
    event_type: string
    event_id: string
    matched: boolean
    deduped: boolean
    success: boolean
    correlation_id: string
  },
  options: LogOptions = {}
): Record<string, unknown> {
  const provider = readText(input.provider).toLowerCase() || "unknown"
  const eventType = readText(input.event_type).toLowerCase() || "unknown"
  const eventId = readText(input.event_id) || "unknown"
  const matched = readBool(input.matched)
  const deduped = readBool(input.deduped)
  const success = readBool(input.success)
  const correlationId = readText(input.correlation_id)

  const payload = logEvent(
    "PAYMENT_WEBHOOK_EVENT",
    {
      provider,
      event_type: eventType,
      event_id: eventId,
      matched,
      deduped,
      success,
    },
    correlationId,
    {
      level: options.level ?? (success ? "info" : "error"),
      scopeOrLogger: options.scopeOrLogger,
    }
  )

  increment("payments.webhook.event.total", {
    ...metricBaseLabels({
      provider,
      success,
      correlation_id: correlationId,
      error_code: null,
    }),
    event_type: eventType,
    matched: matched ? "true" : "false",
    deduped: deduped ? "true" : "false",
  })

  return payload
}

export function logReconcileRun(
  input: {
    provider: string
    checked_count: number
    updated_count: number
    success: boolean
    correlation_id: string
  },
  options: LogOptions = {}
): Record<string, unknown> {
  const provider = readText(input.provider).toLowerCase() || "unknown"
  const checkedCount = toPositiveInt(input.checked_count)
  const updatedCount = toPositiveInt(input.updated_count)
  const success = readBool(input.success)
  const correlationId = readText(input.correlation_id)

  const payload = logEvent(
    "PAYMENT_RECONCILE_RUN",
    {
      provider,
      checked_count: checkedCount,
      updated_count: updatedCount,
      success,
    },
    correlationId,
    {
      level: options.level ?? (success ? "info" : "error"),
      scopeOrLogger: options.scopeOrLogger,
    }
  )

  increment("payments.reconcile.run.total", {
    provider,
    success: success ? "true" : "false",
  })

  return payload
}

