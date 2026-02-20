import {
  PaymentStatus,
  type PaymentTransitionValidator,
  type PaymentStatus as PaymentStatusType,
} from "./contracts"
import {
  applyTransition,
  canTransition,
  logPaymentStateChange as logPaymentStateChangeInternal,
} from "../../../payments/stateMachine"

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function normalizePaymentStatus(value: unknown): PaymentStatusType {
  const normalized = readText(value).toUpperCase()
  if (normalized in PaymentStatus) {
    return PaymentStatus[normalized as keyof typeof PaymentStatus]
  }

  return PaymentStatus.PENDING
}

export type PaymentTransitionResult = {
  current: PaymentStatusType
  next: PaymentStatusType
  changed: boolean
  idempotent: boolean
  valid: boolean
}

export const isPaymentStatusTransitionAllowed: PaymentTransitionValidator = (
  current,
  next
) => {
  return canTransition(current, next)
}

export function transitionPaymentStatus(input: {
  current: PaymentStatusType
  next: PaymentStatusType
  correlation_id: string
  on_invalid?: "throw" | "noop"
}): PaymentTransitionResult {
  const current = normalizePaymentStatus(input.current)
  const next = normalizePaymentStatus(input.next)
  const transition = applyTransition(current, next, {
    correlation_id: input.correlation_id,
    on_invalid: input.on_invalid,
  })

  return {
    current: transition.from,
    next: transition.to,
    changed: transition.changed,
    idempotent: transition.idempotent,
    valid: transition.valid,
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
  return logPaymentStateChangeInternal(input)
}
