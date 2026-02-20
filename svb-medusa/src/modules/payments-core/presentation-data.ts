import type { PaymentPresentationData, PaymentPresentationPrefill } from "../../../payments/types"

type CustomerLike = {
  first_name?: unknown
  last_name?: unknown
  name?: unknown
  email?: unknown
  phone?: unknown
}

type CartLike = {
  email?: unknown
  billing_address?: {
    first_name?: unknown
    last_name?: unknown
    phone?: unknown
  } | null
  shipping_address?: {
    first_name?: unknown
    last_name?: unknown
    phone?: unknown
  } | null
}

type PresentationContext = {
  customer?: CustomerLike | null
  cart?: CartLike | null
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.round(parsed)
    }
  }

  return 0
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {}
  }

  return value as Record<string, unknown>
}

function normalizeProviderId(providerId: string): string {
  return readText(providerId).toLowerCase()
}

function toOptionalPrefill(
  input: PaymentPresentationPrefill
): PaymentPresentationPrefill | undefined {
  const name = readText(input.name)
  const email = readText(input.email)
  const phone = readText(input.phone)

  if (!name && !email && !phone) {
    return undefined
  }

  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  }
}

function resolvePrefill(
  providerSessionData: Record<string, unknown>,
  context: PresentationContext
): PaymentPresentationPrefill | undefined {
  const sessionPrefill = readRecord(providerSessionData.prefill)
  const customer = context.customer ?? {}
  const cart = context.cart ?? {}

  const sessionName = readText(sessionPrefill.name)
  const sessionEmail = readText(sessionPrefill.email)
  const sessionPhone = readText(sessionPrefill.phone || sessionPrefill.contact)

  const customerName = [
    readText(customer.first_name),
    readText(customer.last_name),
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
  const cartBillingName = [
    readText(cart.billing_address?.first_name),
    readText(cart.billing_address?.last_name),
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
  const cartShippingName = [
    readText(cart.shipping_address?.first_name),
    readText(cart.shipping_address?.last_name),
  ]
    .filter(Boolean)
    .join(" ")
    .trim()

  return toOptionalPrefill({
    name:
      sessionName ||
      customerName ||
      readText(customer.name) ||
      cartBillingName ||
      cartShippingName,
    email:
      sessionEmail ||
      readText(customer.email) ||
      readText(cart.email),
    phone:
      sessionPhone ||
      readText(customer.phone) ||
      readText(cart.billing_address?.phone) ||
      readText(cart.shipping_address?.phone),
  })
}

function buildRazorpayPresentationData(
  providerSessionData: Record<string, unknown>,
  context: PresentationContext
): PaymentPresentationData | null {
  const keyId = readText(providerSessionData.razorpay_key_id || providerSessionData.keyId)
  const orderId = readText(
    providerSessionData.razorpay_order_id || providerSessionData.orderId
  )
  const amount = readInteger(providerSessionData.amount)
  const currency = readText(
    providerSessionData.currency_code || providerSessionData.currency
  ).toUpperCase()

  if (!keyId || !orderId || amount <= 0 || !currency) {
    return null
  }

  return {
    type: "razorpay",
    keyId,
    orderId,
    amount,
    currency,
    prefill: resolvePrefill(providerSessionData, context),
  }
}

function buildStripePresentationData(
  providerSessionData: Record<string, unknown>
): PaymentPresentationData | null {
  const clientSecret = readText(
    providerSessionData.client_secret || providerSessionData.clientSecret
  )
  if (!clientSecret) {
    return null
  }

  return {
    type: "stripe",
    clientSecret,
  }
}

export function getPaymentPresentationData(
  providerId: string,
  providerSessionData: Record<string, unknown>,
  context: PresentationContext = {}
): PaymentPresentationData | null {
  const normalizedProvider = normalizeProviderId(providerId)
  if (!normalizedProvider) {
    return null
  }

  if (normalizedProvider.includes("razorpay")) {
    return buildRazorpayPresentationData(providerSessionData, context)
  }

  if (normalizedProvider.includes("stripe")) {
    return buildStripePresentationData(providerSessionData)
  }

  return null
}
