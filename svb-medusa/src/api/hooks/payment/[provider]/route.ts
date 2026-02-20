import crypto from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  Modules,
  PaymentWebhookEvents,
} from "@medusajs/framework/utils"
import {
  CORRELATION_ID_HEADER,
  extractCorrelationIdFromRequest,
} from "../../../../modules/logging/correlation"
import { logEvent } from "../../../../modules/logging/log-event"

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.floor(parsed)
}

function getCorrelationId(req: MedusaRequest): string {
  const fromRequest = readText((req as any)?.correlation_id)
  if (fromRequest) {
    return fromRequest
  }

  const computed = extractCorrelationIdFromRequest(req as any) || crypto.randomUUID()
  ;(req as any).correlation_id = computed
  return computed
}

function sendWebhookError(
  res: MedusaResponse,
  input: {
    status: number
    code: string
    message: string
    details?: Record<string, unknown>
    correlationId: string
  }
): void {
  res.status(input.status).json({
    error: {
      code: input.code,
      message: input.message,
      details: input.details ?? {},
      correlation_id: input.correlationId,
    },
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const correlationId = getCorrelationId(req)
  if (typeof (res as any).setHeader === "function") {
    ;(res as any).setHeader(CORRELATION_ID_HEADER, correlationId)
  }

  const provider = readText(req.params?.provider)

  if (!provider) {
    sendWebhookError(res, {
      status: 400,
      code: "PAYMENT_PROVIDER_REQUIRED",
      message: "Webhook provider param is required.",
      correlationId,
    })
    return
  }

  try {
    const paymentModule = (req as any)?.scope?.resolve?.(Modules.PAYMENT)
    const options = (paymentModule as { options?: Record<string, unknown> })?.options
    const webhookDelay = toPositiveInt(options?.webhook_delay, 5000)
    const webhookRetries = toPositiveInt(options?.webhook_retries, 3)

    const eventBus = (req as any)?.scope?.resolve?.(Modules.EVENT_BUS)
    await eventBus.emit(
      {
        name: PaymentWebhookEvents.WebhookReceived,
        data: {
          provider,
          payload: {
            data: req.body,
            rawData: req.rawBody,
            headers: req.headers,
            correlation_id: correlationId,
          },
        },
      },
      {
        delay: webhookDelay,
        attempts: webhookRetries,
      }
    )

    logEvent(
      "payment.webhook.accepted",
      {
        provider,
      },
      correlationId,
      {
        scopeOrLogger: (req as any).scope,
      }
    )

    res.status(200).json({
      ok: true,
      provider,
      correlation_id: correlationId,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Payment webhook processing failed."

    logEvent(
      "payment.webhook.failed",
      {
        provider,
        error: message,
      },
      correlationId,
      {
        level: "error",
        scopeOrLogger: (req as any).scope,
      }
    )

    sendWebhookError(res, {
      status: 400,
      code: "PAYMENT_WEBHOOK_FAILED",
      message,
      details: { provider },
      correlationId,
    })
  }
}
