import crypto from "crypto"
import type { PaymentEvent } from "../../../payments/types"
import {
  PaymentErrorCode,
  PaymentProviderError,
  PaymentStatus,
  type PaymentStatus as PaymentStatusType,
} from "./contracts"

type ProviderWebhookVerificationInput = {
  raw_body: Buffer
  headers: Record<string, string | string[] | undefined>
  env: Record<string, unknown>
}

export type ProviderWebhookVerificationResult = {
  verified: boolean
  error_code?: string
  message?: string
}

type ProviderWebhookMapInput = {
  provider: string
  body: Record<string, unknown>
  raw_body: Buffer
  headers: Record<string, string | string[] | undefined>
}

export type ProviderWebhookMappedEvent = {
  payment_event: PaymentEvent
  payment_session_id: string
}

export type PaymentWebhookProviderDefinition = {
  id: string
  verifySignature: (
    input: ProviderWebhookVerificationInput
  ) => ProviderWebhookVerificationResult
  mapEvent: (input: ProviderWebhookMapInput) => ProviderWebhookMappedEvent
  toProviderRefs?: (paymentEvent: PaymentEvent) => Record<string, unknown>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function resolveHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const direct = headers[name]
  if (Array.isArray(direct)) {
    return readText(direct[0])
  }
  if (typeof direct === "string") {
    return readText(direct)
  }

  const normalizedName = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== normalizedName) {
      continue
    }
    const candidate = headers[key]
    if (Array.isArray(candidate)) {
      return readText(candidate[0])
    }
    if (typeof candidate === "string") {
      return readText(candidate)
    }
  }

  return ""
}

function toPayloadHash(rawBody: Buffer): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex")
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function toPaymentStatusFromRazorpayEvent(eventType: string): PaymentStatusType | null {
  if (eventType === "payment.authorized") {
    return PaymentStatus.AUTHORIZED
  }
  if (eventType === "payment.captured") {
    return PaymentStatus.CAPTURED
  }
  if (eventType === "payment.failed") {
    return PaymentStatus.FAILED
  }

  return null
}

function verifyRazorpaySignature(
  input: ProviderWebhookVerificationInput
): ProviderWebhookVerificationResult {
  const webhookSecret = readText(input.env.RAZORPAY_WEBHOOK_SECRET)
  if (!webhookSecret) {
    return {
      verified: false,
      error_code: PaymentErrorCode.SIGNATURE_INVALID,
      message: "Webhook signature cannot be verified without RAZORPAY_WEBHOOK_SECRET.",
    }
  }

  const signature = resolveHeader(input.headers, "x-razorpay-signature")
  if (!signature) {
    return {
      verified: false,
      error_code: PaymentErrorCode.SIGNATURE_INVALID,
      message: "Missing webhook signature header.",
    }
  }

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(input.raw_body)
    .digest("hex")

  if (!timingSafeEqual(signature, expected)) {
    return {
      verified: false,
      error_code: PaymentErrorCode.SIGNATURE_INVALID,
      message: "Invalid webhook signature.",
    }
  }

  return {
    verified: true,
  }
}

function mapRazorpayWebhook(input: ProviderWebhookMapInput): ProviderWebhookMappedEvent {
  const eventType = readText(input.body.event).toLowerCase()
  const mappedStatus = toPaymentStatusFromRazorpayEvent(eventType)

  if (!mappedStatus) {
    throw new PaymentProviderError({
      code: PaymentErrorCode.VALIDATION_ERROR,
      message: "Unsupported or invalid webhook event mapping.",
      correlation_id: "pending",
      http_status: 400,
      details: {
        event_type: eventType || null,
      },
    })
  }

  const payload = (input.body.payload ?? {}) as Record<string, unknown>
  const payment = (payload.payment ?? {}) as Record<string, unknown>
  const entity = (payment.entity ?? {}) as Record<string, unknown>

  const providerPaymentId = readText(entity.id)
  const providerOrderId = readText(entity.order_id)
  const notes =
    entity.notes && typeof entity.notes === "object"
      ? (entity.notes as Record<string, unknown>)
      : {}
  const paymentSessionId = readText(notes.session_id)
  if (!paymentSessionId) {
    throw new PaymentProviderError({
      code: PaymentErrorCode.VALIDATION_ERROR,
      message: "Webhook payload is missing payment session reference.",
      correlation_id: "pending",
      http_status: 400,
      details: {
        event_type: eventType || null,
      },
    })
  }

  const eventId =
    resolveHeader(input.headers, "x-razorpay-event-id") ||
    `hash_${toPayloadHash(input.raw_body)}`
  const rawStatus = readText(entity.status).toLowerCase() || null

  const paymentEvent: PaymentEvent = {
    provider: input.provider,
    event_id: eventId,
    event_type: eventType,
    provider_payment_id: providerPaymentId || undefined,
    provider_order_id: providerOrderId || undefined,
    status_mapped: mappedStatus,
    raw_status: rawStatus || undefined,
    occurred_at: new Date().toISOString(),
    payload_sanitized: {
      event_type: eventType,
      event_id: eventId,
      provider_payment_id: providerPaymentId || null,
      provider_order_id: providerOrderId || null,
      mapped_status: mappedStatus,
    },
  }

  return {
    payment_event: paymentEvent,
    payment_session_id: paymentSessionId,
  }
}

function toRazorpayRefs(paymentEvent: PaymentEvent): Record<string, unknown> {
  return {
    razorpay_payment_id: paymentEvent.provider_payment_id ?? null,
    razorpay_order_id: paymentEvent.provider_order_id ?? null,
    razorpay_payment_status: paymentEvent.raw_status ?? null,
  }
}

const PAYMENT_WEBHOOK_PROVIDERS: Record<string, PaymentWebhookProviderDefinition> = {
  razorpay: {
    id: "razorpay",
    verifySignature: verifyRazorpaySignature,
    mapEvent: mapRazorpayWebhook,
    toProviderRefs: toRazorpayRefs,
  },
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function expandProviderCandidates(value: string): string[] {
  const normalized = readText(value).toLowerCase()
  if (!normalized) {
    return []
  }

  if (!normalized.startsWith("pp_")) {
    return dedupe([normalized])
  }

  const body = normalized.slice(3)
  const segments = body.split("_").filter(Boolean)
  const first = segments[0] || ""
  const last = segments[segments.length - 1] || ""

  return dedupe([normalized, body, first, last])
}

export function resolveWebhookProviderDefinition(
  provider: string
): PaymentWebhookProviderDefinition | null {
  const normalized = readText(provider).toLowerCase()
  const candidates = expandProviderCandidates(normalized)

  for (const candidate of candidates) {
    const direct = PAYMENT_WEBHOOK_PROVIDERS[candidate]
    if (direct) {
      return direct
    }
  }

  for (const key of Object.keys(PAYMENT_WEBHOOK_PROVIDERS)) {
    if (normalized.includes(key)) {
      return PAYMENT_WEBHOOK_PROVIDERS[key]
    }
  }

  return null
}

export function listWebhookProviderDefinitions(): string[] {
  return Object.keys(PAYMENT_WEBHOOK_PROVIDERS)
}
