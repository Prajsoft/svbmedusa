import crypto from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  CORRELATION_ID_HEADER,
  extractCorrelationIdFromRequest,
} from "../../../../modules/logging/correlation"
import { logEvent } from "../../../../modules/logging/log-event"
import {
  PaymentErrorCode,
  PaymentProviderError,
  PaymentWebhookEventRepository,
  processSharedPaymentWebhook,
  toPaymentErrorEnvelope,
} from "../../../../modules/payments-core"

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

type PgConnectionLike = {
  raw: (query: string, bindings?: unknown[]) => Promise<{
    rows?: Array<Record<string, unknown>>
  }>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function getCorrelationId(req: MedusaRequest): string {
  const existing = readText((req as Record<string, unknown>).correlation_id)
  if (existing) {
    return existing
  }

  const resolved = extractCorrelationIdFromRequest(req as any) || crypto.randomUUID()
  ;(req as Record<string, unknown>).correlation_id = resolved
  return resolved
}

function toRawBody(req: MedusaRequest): Buffer {
  if (Buffer.isBuffer((req as any).rawBody)) {
    return (req as any).rawBody as Buffer
  }

  return Buffer.from(JSON.stringify(req.body ?? {}))
}

function normalizeProviderError(
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
  if (error instanceof PaymentProviderError) {
    return {
      status: error.http_status,
      body: error.toErrorEnvelope(),
    }
  }

  return toPaymentErrorEnvelope(
    {
      code: "PAYMENT_WEBHOOK_FAILED",
      message:
        error instanceof Error ? error.message : "Payment webhook processing failed.",
      details: {},
    },
    {
      correlation_id: correlationId,
      fallback_code: "PAYMENT_WEBHOOK_FAILED",
      fallback_message: "Payment webhook processing failed.",
      fallback_http_status: 500,
    }
  )
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const correlationId = getCorrelationId(req)
  if (typeof (res as any).setHeader === "function") {
    ;(res as any).setHeader(CORRELATION_ID_HEADER, correlationId)
  }

  const provider = readText(req.params?.provider)
  const eventType = readText((req.body as Record<string, unknown>)?.event).toLowerCase()

  try {
    const scope = (req as any)?.scope
    const query = scope?.resolve?.(ContainerRegistrationKeys.QUERY) as QueryGraphLike
    const paymentModule = scope?.resolve?.(Modules.PAYMENT) as PaymentModuleLike
    const pgConnection = scope?.resolve?.(
      ContainerRegistrationKeys.PG_CONNECTION
    ) as PgConnectionLike

    if (!query || typeof query.graph !== "function") {
      throw new PaymentProviderError({
        code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
        message: "Payment webhook query dependency is unavailable.",
        correlation_id: correlationId,
        http_status: 503,
      })
    }

    if (
      !paymentModule ||
      typeof paymentModule.updatePaymentSession !== "function"
    ) {
      throw new PaymentProviderError({
        code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
        message: "Payment module dependency is unavailable for webhook processing.",
        correlation_id: correlationId,
        http_status: 503,
      })
    }

    if (!pgConnection || typeof pgConnection.raw !== "function") {
      throw new PaymentProviderError({
        code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
        message: "PG connection is unavailable for webhook dedupe.",
        correlation_id: correlationId,
        http_status: 503,
      })
    }

    const repository = new PaymentWebhookEventRepository(pgConnection)
    const result = await processSharedPaymentWebhook({
      provider,
      body: (req.body ?? {}) as Record<string, unknown>,
      raw_body: toRawBody(req),
      headers: (req.headers ?? {}) as Record<string, string | string[] | undefined>,
      correlation_id: correlationId,
      query,
      payment_module: paymentModule,
      repository,
      scopeOrLogger: scope,
    })

    if (result.deduped) {
      logEvent(
        "WEBHOOK_DEDUP_HIT",
        {
          provider: result.provider,
          event_id: result.event_id,
          event_type: result.event_type,
        },
        correlationId,
        {
          scopeOrLogger: scope,
        }
      )
    }

    res.status(200).json({
      ok: true,
      processed: result.processed,
      deduped: result.deduped,
      provider: result.provider,
      event_id: result.event_id,
      event_type: result.event_type,
      payment_session_id: result.payment_session_id ?? null,
      correlation_id: correlationId,
    })
  } catch (error) {
    const normalized = normalizeProviderError(error, correlationId)

    logEvent(
      "PAYMENT_WEBHOOK_FAILED",
      {
        provider: provider || null,
        event_type: eventType || null,
        error_code: normalized.body.error.code,
        error_message: normalized.body.error.message,
      },
      correlationId,
      {
        level: "error",
        scopeOrLogger: (req as any).scope,
      }
    )

    res.status(normalized.status).json(normalized.body)
  }
}
