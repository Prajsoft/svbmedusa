import * as PaymentTypes from "../../../payments/types"
import type {
  PaymentErrorCode as PaymentErrorCodeType,
  PaymentErrorShape as PaymentErrorObject,
  PaymentEvent,
  PaymentStatus as PaymentStatusType,
  PaymentTransitionValidator,
} from "../../../payments/types"

export const PaymentErrorCode = PaymentTypes.PaymentErrorCode
export const PaymentStatus = PaymentTypes.PaymentStatus
export type PaymentErrorCode = PaymentErrorCodeType
export type PaymentStatus = PaymentStatusType
export type { PaymentErrorObject, PaymentEvent, PaymentTransitionValidator }

export type PaymentErrorEnvelope = {
  error: PaymentErrorObject
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export class PaymentProviderError extends Error {
  code: string
  http_status: number
  httpStatus: number
  details: Record<string, unknown>
  correlation_id: string
  correlationId: string

  constructor(input: {
    code: string
    message: string
    correlation_id: string
    http_status?: number
    details?: Record<string, unknown>
  }) {
    super(input.message)
    this.name = "PaymentProviderError"
    this.code = input.code
    this.http_status = input.http_status ?? 500
    this.httpStatus = this.http_status
    this.details = input.details ?? {}
    this.correlation_id = input.correlation_id
    this.correlationId = this.correlation_id
  }

  toErrorEnvelope(): PaymentErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        correlation_id: this.correlation_id,
      },
    }
  }
}

export function toPaymentErrorEnvelope(
  error: unknown,
  input: {
    correlation_id: string
    fallback_code?: string
    fallback_message?: string
    fallback_http_status?: number
  }
): {
  status: number
  body: PaymentErrorEnvelope
} {
  if (error instanceof PaymentProviderError) {
    return {
      status: error.http_status,
      body: error.toErrorEnvelope(),
    }
  }

  const fallbackCode = readText(input.fallback_code) || PaymentErrorCode.INTERNAL_ERROR
  const fallbackMessage = readText(input.fallback_message) || "Unexpected payment error."
  const fallbackStatus = Number.isFinite(input.fallback_http_status)
    ? Math.max(100, Math.floor(input.fallback_http_status as number))
    : 500

  const code =
    error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string"
      ? readText((error as { code: string }).code)
      : fallbackCode

  const message =
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
      ? readText((error as { message: string }).message)
      : fallbackMessage

  const details =
    error &&
    typeof error === "object" &&
    (error as { details?: unknown }).details &&
    typeof (error as { details?: unknown }).details === "object"
      ? ((error as { details: Record<string, unknown> }).details ?? {})
      : {}

  return {
    status: fallbackStatus,
    body: {
      error: {
        code: code || fallbackCode,
        message: message || fallbackMessage,
        details,
        correlation_id: input.correlation_id,
      },
    },
  }
}
