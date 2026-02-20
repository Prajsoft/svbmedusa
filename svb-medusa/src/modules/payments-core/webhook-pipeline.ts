import crypto from "crypto"
import { PaymentSessionStatus } from "@medusajs/framework/utils"
import { logWebhookEvent } from "../../../payments/observability"
import {
  PaymentErrorCode,
  PaymentProviderError,
  PaymentStatus,
  type PaymentStatus as PaymentStatusType,
} from "./contracts"
import { PaymentWebhookEventRepository } from "./payment-webhook-event-repository"
import { transitionPaymentStatus } from "./state-machine"
import {
  type ProviderWebhookMappedEvent,
  resolveWebhookProviderDefinition,
} from "./webhook-provider-registry"
import { shouldAllowUnverifiedWebhook } from "./webhook-policy"

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
}

type PaymentSessionState = {
  id: string
  status: string
  amount: number
  currency_code: string
  data: Record<string, unknown>
}

export type ProcessWebhookInput = {
  provider: string
  body: Record<string, unknown>
  raw_body: Buffer
  headers: Record<string, string | string[] | undefined>
  correlation_id: string
  env?: Record<string, unknown>
  query: QueryGraphLike
  payment_module: PaymentModuleLike
  repository: PaymentWebhookEventRepository
  scopeOrLogger?: unknown
}

export type ProcessWebhookResult = {
  processed: boolean
  deduped: boolean
  matched: boolean
  provider: string
  event_id: string
  event_type: string
  payment_session_id?: string
  correlation_id: string
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

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value
  }

  if (typeof value === "string") {
    return Buffer.from(value)
  }

  return Buffer.from(JSON.stringify(value ?? {}))
}

function normalizeProvider(value: unknown): string {
  return readText(value).toLowerCase()
}

function toInternalFromSession(session: PaymentSessionState): PaymentStatusType {
  const explicit = readText(session.data.payment_status).toUpperCase()
  if (explicit && explicit in PaymentStatus) {
    return PaymentStatus[explicit as keyof typeof PaymentStatus]
  }

  const status = readText(session.status).toLowerCase()
  if (status === PaymentSessionStatus.AUTHORIZED) {
    return PaymentStatus.AUTHORIZED
  }
  if (status === PaymentSessionStatus.CAPTURED) {
    return PaymentStatus.CAPTURED
  }
  if (status === PaymentSessionStatus.ERROR) {
    return PaymentStatus.FAILED
  }
  if (status === PaymentSessionStatus.CANCELED) {
    return PaymentStatus.CANCELLED
  }

  return PaymentStatus.PENDING
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
  if (status === PaymentStatus.CANCELLED) {
    return PaymentSessionStatus.CANCELED
  }

  return PaymentSessionStatus.PENDING
}

async function getPaymentSessionState(
  query: QueryGraphLike,
  sessionId: string
): Promise<PaymentSessionState | null> {
  const response = await query.graph({
    entity: "payment_session",
    fields: ["id", "status", "amount", "currency_code", "data"],
    filters: {
      id: sessionId,
    },
  })

  const row =
    Array.isArray(response?.data) && response?.data[0]
      ? (response.data[0] as Record<string, unknown>)
      : null
  if (!row) {
    return null
  }

  const id = readText(row.id)
  if (!id) {
    return null
  }

  const data =
    row.data && typeof row.data === "object"
      ? (row.data as Record<string, unknown>)
      : {}

  return {
    id,
    status: readText(row.status).toLowerCase(),
    amount: Math.max(0, Math.round(readNumber(row.amount))),
    currency_code: readText(row.currency_code).toUpperCase() || "INR",
    data,
  }
}

function throwWebhookError(input: {
  code: string
  message: string
  correlation_id: string
  status?: number
  details?: Record<string, unknown>
}): never {
  throw new PaymentProviderError({
    code: input.code,
    message: input.message,
    correlation_id: input.correlation_id,
    http_status: input.status ?? 400,
    details: input.details ?? {},
  })
}

export async function processSharedPaymentWebhook(
  input: ProcessWebhookInput
): Promise<ProcessWebhookResult> {
  const correlationId = readText(input.correlation_id) || crypto.randomUUID()
  const requestedProvider = normalizeProvider(input.provider)
  const env = input.env ?? process.env
  const rawBody = toBuffer(input.raw_body)

  if (!requestedProvider) {
    throwWebhookError({
      code: PaymentErrorCode.VALIDATION_ERROR,
      message: "Webhook provider param is required.",
      correlation_id: correlationId,
      status: 400,
    })
  }

  const providerDefinition = resolveWebhookProviderDefinition(requestedProvider)
  if (!providerDefinition) {
    throwWebhookError({
      code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
      message: `Webhook provider is not supported: ${requestedProvider}`,
      correlation_id: correlationId,
      status: 404,
      details: {
        provider: requestedProvider,
      },
    })
  }
  const provider = providerDefinition.id

  const verification = providerDefinition.verifySignature({
    raw_body: rawBody,
    headers: input.headers,
    env,
  })
  const allowUnsigned = shouldAllowUnverifiedWebhook({
    env,
  })
  if (!verification.verified && !allowUnsigned) {
    logWebhookEvent(
      {
        provider,
        event_type: readText(input.body.event).toLowerCase() || "unknown",
        event_id: "unknown",
        matched: false,
        deduped: false,
        success: false,
        correlation_id: correlationId,
      },
      {
        level: "error",
        scopeOrLogger: input.scopeOrLogger,
      }
    )
    throwWebhookError({
      code: verification.error_code || PaymentErrorCode.SIGNATURE_INVALID,
      message: verification.message || "Webhook signature verification failed.",
      correlation_id: correlationId,
      status: 401,
    })
  }

  let mapped: ProviderWebhookMappedEvent
  try {
    mapped = providerDefinition.mapEvent({
      provider,
      body: input.body,
      raw_body: rawBody,
      headers: input.headers,
    })
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      throwWebhookError({
        code: error.code || PaymentErrorCode.VALIDATION_ERROR,
        message: error.message || "Webhook event mapping failed.",
        correlation_id: correlationId,
        status: error.http_status || 400,
        details: error.details,
      })
    }

    throw error
  }

  const dedupe = await input.repository.markProcessed({
    provider,
    event_id: mapped.payment_event.event_id,
  })
  if (!dedupe.processed) {
    logWebhookEvent(
      {
        provider,
        event_type: mapped.payment_event.event_type,
        event_id: mapped.payment_event.event_id,
        matched: false,
        deduped: true,
        success: true,
        correlation_id: correlationId,
      },
      {
        scopeOrLogger: input.scopeOrLogger,
      }
    )

    return {
      processed: false,
      deduped: true,
      matched: false,
      provider,
      event_id: mapped.payment_event.event_id,
      event_type: mapped.payment_event.event_type,
      correlation_id: correlationId,
    }
  }

  const session = await getPaymentSessionState(
    input.query,
    mapped.payment_session_id
  )
  if (!session) {
    throwWebhookError({
      code: PaymentErrorCode.VALIDATION_ERROR,
      message: "Mapped payment session not found for webhook event.",
      correlation_id: correlationId,
      status: 400,
      details: {
        payment_session_id: mapped.payment_session_id,
      },
    })
  }

  const current = toInternalFromSession(session)
  const transition = transitionPaymentStatus({
    current,
    next: mapped.payment_event.status_mapped,
    correlation_id: correlationId,
    on_invalid: "noop",
  })

  if (transition.valid && transition.changed) {
    const providerRefs: Record<string, unknown> = {
      provider: provider,
      provider_event_id: mapped.payment_event.event_id,
      provider_event_type: mapped.payment_event.event_type,
      provider_payment_id: mapped.payment_event.provider_payment_id ?? null,
      provider_order_id: mapped.payment_event.provider_order_id ?? null,
    }
    const providerSpecificRefs = providerDefinition.toProviderRefs?.(
      mapped.payment_event
    )
    if (providerSpecificRefs && typeof providerSpecificRefs === "object") {
      Object.assign(providerRefs, providerSpecificRefs)
    }

    await input.payment_module.updatePaymentSession({
      id: session.id,
      amount: session.amount,
      currency_code: session.currency_code || "INR",
      data: {
        ...session.data,
        ...providerRefs,
        payment_status: transition.next,
        correlation_id: correlationId,
        webhook_received_at: mapped.payment_event.occurred_at,
      },
      status: toMedusaStatus(transition.next),
    })
  }

  logWebhookEvent(
    {
      provider,
      event_type: mapped.payment_event.event_type,
      event_id: mapped.payment_event.event_id,
      matched: true,
      deduped: false,
      success: true,
      correlation_id: correlationId,
    },
    {
      scopeOrLogger: input.scopeOrLogger,
    }
  )

  return {
    processed: true,
    deduped: false,
    matched: transition.valid,
    provider,
    event_id: mapped.payment_event.event_id,
    event_type: mapped.payment_event.event_type,
    payment_session_id: mapped.payment_session_id,
    correlation_id: correlationId,
  }
}
