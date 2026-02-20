import crypto from "crypto"
import { logEvent } from "../src/modules/logging/log-event"
import { PaymentProviderError } from "../src/modules/payments-core/contracts"
import { PaymentErrorCode, PaymentStatus, type PaymentStatus as PaymentStatusType } from "./types"

const ALLOWED_TRANSITIONS: Record<PaymentStatusType, Set<PaymentStatusType>> = {
  [PaymentStatus.PENDING]: new Set([
    PaymentStatus.AUTHORIZED,
    PaymentStatus.CAPTURED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ]),
  [PaymentStatus.AUTHORIZED]: new Set([
    PaymentStatus.CAPTURED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ]),
  [PaymentStatus.CAPTURED]: new Set([PaymentStatus.REFUNDED]),
  [PaymentStatus.FAILED]: new Set(),
  [PaymentStatus.CANCELLED]: new Set(),
  [PaymentStatus.REFUNDED]: new Set(),
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeStatus(value: PaymentStatusType): PaymentStatusType {
  const normalized = readText(value).toUpperCase()
  if (normalized === "CANCELED") {
    return PaymentStatus.CANCELLED
  }

  if (normalized in PaymentStatus) {
    return PaymentStatus[normalized as keyof typeof PaymentStatus]
  }

  return value
}

export function canTransition(
  from: PaymentStatusType,
  to: PaymentStatusType
): boolean {
  const normalizedFrom = normalizeStatus(from)
  const normalizedTo = normalizeStatus(to)

  if (normalizedFrom === normalizedTo) {
    return true
  }

  const allowed = ALLOWED_TRANSITIONS[normalizedFrom]
  return Boolean(allowed?.has(normalizedTo))
}

export type ApplyTransitionResult = {
  from: PaymentStatusType
  to: PaymentStatusType
  changed: boolean
  idempotent: boolean
  valid: boolean
}

export function applyTransition(
  current: PaymentStatusType,
  to: PaymentStatusType,
  options: {
    correlation_id?: string
    on_invalid?: "throw" | "noop"
  } = {}
): ApplyTransitionResult {
  const from = normalizeStatus(current)
  const next = normalizeStatus(to)
  const correlationId = readText(options.correlation_id) || crypto.randomUUID()

  if (from === next) {
    return {
      from,
      to: next,
      changed: false,
      idempotent: true,
      valid: true,
    }
  }

  if (!canTransition(from, next)) {
    if (options.on_invalid === "noop") {
      return {
        from,
        to: from,
        changed: false,
        idempotent: false,
        valid: false,
      }
    }

    throw new PaymentProviderError({
      code: PaymentErrorCode.STATE_TRANSITION_INVALID,
      message: `Invalid payment transition: ${from} -> ${next}`,
      correlation_id: correlationId,
      http_status: 409,
      details: {
        from,
        to: next,
      },
    })
  }

  return {
    from,
    to: next,
    changed: true,
    idempotent: false,
    valid: true,
  }
}

export function logPaymentStateChange(input: {
  payment_id: string
  from: PaymentStatusType
  to: PaymentStatusType
  source: string
  correlation_id: string
  scopeOrLogger?: unknown
}): Record<string, unknown> {
  return logEvent(
    "PAYMENT_STATE_CHANGE",
    {
      payment_id: readText(input.payment_id),
      from: normalizeStatus(input.from),
      to: normalizeStatus(input.to),
      source: readText(input.source) || "unknown",
    },
    input.correlation_id,
    {
      scopeOrLogger: input.scopeOrLogger,
    }
  )
}
