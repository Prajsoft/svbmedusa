import crypto from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { logProviderCall, logReconcileRun } from "../../../payments/observability"
import { increment } from "../observability/metrics"
import {
  PaymentErrorCode,
  PaymentProviderError,
  PaymentStatus,
  type PaymentStatus as PaymentStatusType,
} from "./contracts"
import { logPaymentProviderEvent } from "./observability"
import { transitionPaymentStatus } from "./state-machine"

type QueryGraphLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

type PaymentModuleLike = {
  updatePaymentSession: (input: {
    id: string
    amount: number
    currency_code: string
    data: Record<string, unknown>
    status: string
  }) => Promise<unknown>
  paymentProviderService_?: PaymentProviderStatusServiceLike
}

type ProviderStatusInput = {
  data: Record<string, unknown>
}

type ProviderStatusOutput = {
  status?: string
  data?: Record<string, unknown>
}

type PaymentProviderStatusServiceLike = {
  getStatus: (
    providerId: string,
    input: ProviderStatusInput
  ) => Promise<ProviderStatusOutput>
}

type ReconcileInput = {
  now_ms?: number
  stuck_minutes?: number
  max_sessions?: number
}

type SessionRow = {
  id: string
  provider_id: string
  status: string
  amount: number
  currency_code: string
  updated_at: number
  data: Record<string, unknown>
}

export type ReconcileResult = {
  scanned: number
  candidates: number
  reconciled: number
  skipped: number
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

function toMillis(value: unknown): number {
  const text = readText(value)
  if (!text) {
    return 0
  }

  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = readNumber(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.floor(parsed)
}

function normalizeSessionStatus(value: unknown): string {
  return readText(value).toLowerCase()
}

function toInternalFromMedusaStatus(value: unknown): PaymentStatusType {
  const normalized = normalizeSessionStatus(value)
  if (normalized === PaymentSessionStatus.AUTHORIZED) {
    return PaymentStatus.AUTHORIZED
  }

  if (normalized === PaymentSessionStatus.CAPTURED) {
    return PaymentStatus.CAPTURED
  }

  if (normalized === PaymentSessionStatus.ERROR) {
    return PaymentStatus.FAILED
  }

  if (normalized === PaymentSessionStatus.CANCELED) {
    return PaymentStatus.CANCELED
  }

  return PaymentStatus.PENDING
}

function toInternalFromProviderData(data: Record<string, unknown>): PaymentStatusType | null {
  const explicit = readText(data.payment_status).toUpperCase()
  if (explicit && explicit in PaymentStatus) {
    return PaymentStatus[explicit as keyof typeof PaymentStatus]
  }

  const razorpayStatus = readText(data.razorpay_payment_status).toLowerCase()
  if (!razorpayStatus || razorpayStatus === "created" || razorpayStatus === "pending") {
    return PaymentStatus.PENDING
  }
  if (razorpayStatus === "authorized") {
    return PaymentStatus.AUTHORIZED
  }
  if (razorpayStatus === "captured") {
    return PaymentStatus.CAPTURED
  }
  if (razorpayStatus === "refunded") {
    return PaymentStatus.REFUNDED
  }
  if (razorpayStatus === "failed") {
    return PaymentStatus.FAILED
  }
  if (razorpayStatus === "canceled" || razorpayStatus === "cancelled") {
    return PaymentStatus.CANCELED
  }

  return null
}

function toInternalFromProviderState(input: {
  status?: unknown
  data?: Record<string, unknown>
}): PaymentStatusType | null {
  const data = input.data ?? {}
  const fromData = toInternalFromProviderData(data)
  if (fromData) {
    return fromData
  }

  const normalizedStatus = normalizeSessionStatus(input.status)
  if (!normalizedStatus) {
    return null
  }

  if (
    normalizedStatus === PaymentSessionStatus.PENDING ||
    normalizedStatus === PaymentSessionStatus.REQUIRES_MORE ||
    normalizedStatus === PaymentSessionStatus.AUTHORIZED ||
    normalizedStatus === PaymentSessionStatus.CAPTURED ||
    normalizedStatus === PaymentSessionStatus.ERROR ||
    normalizedStatus === PaymentSessionStatus.CANCELED
  ) {
    return toInternalFromMedusaStatus(normalizedStatus)
  }

  return null
}

function toMedusaStatus(status: PaymentStatusType): PaymentSessionStatus {
  if (status === PaymentStatus.AUTHORIZED) {
    return PaymentSessionStatus.AUTHORIZED
  }

  if (status === PaymentStatus.CAPTURED || status === PaymentStatus.REFUNDED) {
    return PaymentSessionStatus.CAPTURED
  }

  if (status === PaymentStatus.FAILED) {
    return PaymentSessionStatus.ERROR
  }

  if (status === PaymentStatus.CANCELED) {
    return PaymentSessionStatus.CANCELED
  }

  return PaymentSessionStatus.PENDING
}

function asSessionRow(value: unknown): SessionRow | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const row = value as Record<string, unknown>
  const id = readText(row.id)
  if (!id) {
    return null
  }

  const data =
    row.data && typeof row.data === "object"
      ? (row.data as Record<string, unknown>)
      : {}

  const updatedAt =
    toMillis(row.updated_at) || toMillis(row.created_at) || Date.now()

  return {
    id,
    provider_id: readText(row.provider_id),
    status: normalizeSessionStatus(row.status),
    amount: Math.max(0, Math.round(readNumber(row.amount))),
    currency_code: readText(row.currency_code).toUpperCase() || "INR",
    updated_at: updatedAt,
    data,
  }
}

function resolveProviderStatusService(
  paymentModule: PaymentModuleLike
): PaymentProviderStatusServiceLike {
  const providerService = paymentModule.paymentProviderService_
  if (providerService && typeof providerService.getStatus === "function") {
    return providerService
  }

  throw new PaymentProviderError({
    code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
    message:
      "Payment provider status service is unavailable for reconciliation.",
    correlation_id: `recon_provider_service_${crypto.randomUUID()}`,
    http_status: 503,
    details: {},
  })
}

export async function runStuckPaymentReconciliation(
  container: MedusaContainer,
  input: ReconcileInput = {}
): Promise<ReconcileResult> {
  const scope = container as unknown as {
    resolve: (key: string) => unknown
  }
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraphLike
  const paymentModule = scope.resolve(Modules.PAYMENT) as PaymentModuleLike
  const providerStatusService = resolveProviderStatusService(paymentModule)
  const loggerScope = scope as unknown
  const nowMs = toPositiveInt(input.now_ms, Date.now())
  const stuckMinutes = toPositiveInt(
    input.stuck_minutes ?? process.env.PAYMENTS_RECONCILIATION_STUCK_MINUTES,
    30
  )
  const maxSessions = toPositiveInt(
    input.max_sessions ?? process.env.PAYMENTS_RECONCILIATION_MAX_SESSIONS,
    200
  )
  const minAgeMs = stuckMinutes * 60 * 1000
  const scanCorrelationId = `recon_${crypto.randomUUID()}`

  logPaymentProviderEvent(
    "PAYMENT_RECONCILIATION_SCAN_STARTED",
    {
      provider: "all",
      correlation_id: scanCorrelationId,
      details: {
        stuck_minutes: stuckMinutes,
        max_sessions: maxSessions,
      },
    },
    { scopeOrLogger: loggerScope }
  )

  const result: ReconcileResult = {
    scanned: 0,
    candidates: 0,
    reconciled: 0,
    skipped: 0,
  }

  try {
    const response = await query.graph({
      entity: "payment_session",
      fields: [
        "id",
        "provider_id",
        "status",
        "amount",
        "currency_code",
        "updated_at",
        "created_at",
        "data",
      ],
    })

    const rows = (Array.isArray(response?.data) ? response.data : [])
      .map((entry) => asSessionRow(entry))
      .filter(Boolean) as SessionRow[]

    result.scanned = rows.length

    const candidates = rows
      .filter((row) => row.provider_id.startsWith("pp_"))
      .filter((row) => {
        const current = toInternalFromMedusaStatus(row.status)
        if (
          current !== PaymentStatus.PENDING &&
          current !== PaymentStatus.AUTHORIZED
        ) {
          return false
        }

        const ageMs = nowMs - row.updated_at
        return ageMs >= minAgeMs
      })
      .slice(0, maxSessions)

    result.candidates = candidates.length

    for (const row of candidates) {
      const correlationId =
        readText(row.data.correlation_id) || `recon_session_${row.id}`
      const current = toInternalFromMedusaStatus(row.status)
      const startedAt = Date.now()
      let providerStatusResult: ProviderStatusOutput

      try {
        providerStatusResult = await providerStatusService.getStatus(
          row.provider_id,
          {
            data: { ...row.data },
          }
        )
        logProviderCall(
          {
            provider: row.provider_id,
            method: "status.fetch",
            duration_ms: Date.now() - startedAt,
            success: true,
            correlation_id: correlationId,
            payment_session_id: row.id,
          },
          {
            scopeOrLogger: loggerScope,
          }
        )
      } catch (error) {
        logProviderCall(
          {
            provider: row.provider_id,
            method: "status.fetch",
            duration_ms: Date.now() - startedAt,
            success: false,
            error_code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
            correlation_id: correlationId,
            payment_session_id: row.id,
          },
          {
            scopeOrLogger: loggerScope,
          }
        )

        throw new PaymentProviderError({
          code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
          message: "Payment provider status fetch failed during reconciliation.",
          correlation_id: correlationId,
          http_status: 503,
          details: {
            payment_session_id: row.id,
            provider_id: row.provider_id,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        })
      }

      const providerData =
        providerStatusResult.data && typeof providerStatusResult.data === "object"
          ? providerStatusResult.data
          : {}
      const next = toInternalFromProviderState({
        status: providerStatusResult.status,
        data: providerData,
      })
      if (!next) {
        result.skipped += 1
        continue
      }

      const transition = transitionPaymentStatus({
        current,
        next,
        correlation_id: correlationId,
        on_invalid: "noop",
      })

      if (!transition.valid || !transition.changed) {
        result.skipped += 1
        continue
      }

      const nextStatus = toMedusaStatus(transition.next)

      await paymentModule.updatePaymentSession({
        id: row.id,
        amount: row.amount,
        currency_code: row.currency_code,
        data: {
          ...row.data,
          ...providerData,
          payment_status: transition.next,
          correlation_id: correlationId,
          reconciled_at: new Date(nowMs).toISOString(),
        },
        status: nextStatus,
      })

      result.reconciled += 1
      increment("payments.reconciliation.reconciled")
      logPaymentProviderEvent(
        "PAYMENT_RECONCILIATION_SESSION_RECONCILED",
        {
          provider: row.provider_id || "unknown",
          correlation_id: correlationId,
          details: {
            payment_session_id: row.id,
            from: current,
            to: transition.next,
            next_status: nextStatus,
          },
        },
        { scopeOrLogger: loggerScope }
      )
    }

    logPaymentProviderEvent(
      "PAYMENT_RECONCILIATION_SCAN_COMPLETED",
      {
        provider: "all",
        correlation_id: scanCorrelationId,
        details: result,
      },
      { scopeOrLogger: loggerScope }
    )
    logReconcileRun(
      {
        provider: "all",
        checked_count: result.candidates,
        updated_count: result.reconciled,
        success: true,
        correlation_id: scanCorrelationId,
      },
      {
        scopeOrLogger: loggerScope,
      }
    )
    return result
  } catch (error) {
    increment("payments.reconciliation.failed")
    logReconcileRun(
      {
        provider: "all",
        checked_count: result.candidates,
        updated_count: result.reconciled,
        success: false,
        correlation_id: scanCorrelationId,
      },
      {
        level: "error",
        scopeOrLogger: loggerScope,
      }
    )
    logPaymentProviderEvent(
      "PAYMENT_RECONCILIATION_SCAN_FAILED",
      {
        provider: "all",
        correlation_id: scanCorrelationId,
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      },
      { level: "error", scopeOrLogger: loggerScope }
    )
    throw error
  }
}
