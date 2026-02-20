export const PaymentStatus = {
  PENDING: "PENDING",
  AUTHORIZED: "AUTHORIZED",
  CAPTURED: "CAPTURED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
  // Backward-compatible alias; canonical status is CANCELLED.
  CANCELED: "CANCELLED",
} as const

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus]

export const PaymentErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  AUTH_FAILED: "AUTH_FAILED",
  SIGNATURE_INVALID: "SIGNATURE_INVALID",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  NOT_SUPPORTED: "NOT_SUPPORTED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  DUPLICATE: "DUPLICATE",
  STATE_TRANSITION_INVALID: "STATE_TRANSITION_INVALID",
  PAYMENT_WEBHOOK_UNVERIFIED_REJECTED: "PAYMENT_WEBHOOK_UNVERIFIED_REJECTED",
  RAZORPAY_CONFIG_MISSING: "RAZORPAY_CONFIG_MISSING",
  RAZORPAY_CONFIG_MODE_MISMATCH: "RAZORPAY_CONFIG_MODE_MISMATCH",
  RAZORPAY_PROVIDER_REGISTRATION_FAILED: "RAZORPAY_PROVIDER_REGISTRATION_FAILED",
  CURRENCY_NOT_SUPPORTED: "CURRENCY_NOT_SUPPORTED",
  RAZORPAY_AUTH_FAILED: "RAZORPAY_AUTH_FAILED",
  RAZORPAY_BAD_REQUEST: "RAZORPAY_BAD_REQUEST",
  RAZORPAY_RATE_LIMIT: "RAZORPAY_RATE_LIMIT",
  RAZORPAY_UPSTREAM_ERROR: "RAZORPAY_UPSTREAM_ERROR",
  RAZORPAY_WEBHOOK_SECRET_MISSING: "RAZORPAY_WEBHOOK_SECRET_MISSING",
  RAZORPAY_SIGNATURE_MISSING: "RAZORPAY_SIGNATURE_MISSING",
  RAZORPAY_SIGNATURE_INVALID: "RAZORPAY_SIGNATURE_INVALID",
  // Backward-compatible alias.
  PAYMENT_STATE_INVALID_TRANSITION: "STATE_TRANSITION_INVALID",
} as const

export type PaymentErrorCode = (typeof PaymentErrorCode)[keyof typeof PaymentErrorCode]

export type PaymentErrorShape = {
  code: string
  message: string
  details: Record<string, unknown>
  correlation_id: string
}

export type PaymentEvent = {
  provider: string
  event_id: string
  event_type: string
  provider_payment_id?: string
  provider_order_id?: string
  status_mapped: PaymentStatus
  raw_status?: string
  occurred_at: string
  payload_sanitized?: Record<string, unknown>
}

export type PaymentTransitionValidator = (
  current: PaymentStatus,
  next: PaymentStatus
) => boolean

export type PaymentPresentationPrefill = {
  name?: string
  email?: string
  phone?: string
}

export type RazorpayPaymentPresentationData = {
  type: "razorpay"
  keyId: string
  orderId: string
  amount: number
  currency: string
  prefill?: PaymentPresentationPrefill
}

export type StripePaymentPresentationData = {
  type: "stripe"
  clientSecret: string
}

export type PaymentPresentationData =
  | RazorpayPaymentPresentationData
  | StripePaymentPresentationData
