export type RazorpayPaymentsMode = "test" | "live"

export type RazorpayConfig = {
  mode: RazorpayPaymentsMode
  keyId: string
  keySecret: string
  webhookSecret?: string
}

export class RazorpayConfigError extends Error {
  code: string
  reason: string
  details: Record<string, unknown>

  constructor(input: {
    code: string
    reason: string
    details?: Record<string, unknown>
  }) {
    super(input.code)
    this.name = "RazorpayConfigError"
    this.code = input.code
    this.reason = input.reason
    this.details = input.details ?? {}
  }
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readMode(value: unknown): RazorpayPaymentsMode {
  const normalized = readText(value).toLowerCase()
  if (normalized === "test") {
    return "test"
  }

  if (normalized === "live") {
    return "live"
  }

  throw new RazorpayConfigError({
    code: "RAZORPAY_CONFIG_INVALID_MODE",
    reason: "PAYMENTS_MODE must be 'test' or 'live'.",
    details: {
      mode: normalized || null,
    },
  })
}

function assertRequired(name: string, value: string): void {
  if (value) {
    return
  }

  throw new RazorpayConfigError({
    code: "RAZORPAY_CONFIG_MISSING",
    reason: `${name} is required.`,
    details: {
      field: name,
    },
  })
}

export function validateRazorpayConfig(
  env: Record<string, unknown> = process.env
): RazorpayConfig {
  const mode = readMode(env.PAYMENTS_MODE ?? "test")
  const keyId = readText(env.RAZORPAY_KEY_ID)
  const keySecret = readText(env.RAZORPAY_KEY_SECRET)
  const webhookSecret = readText(env.RAZORPAY_WEBHOOK_SECRET) || undefined

  assertRequired("RAZORPAY_KEY_ID", keyId)
  assertRequired("RAZORPAY_KEY_SECRET", keySecret)
  if (mode === "live") {
    assertRequired("RAZORPAY_WEBHOOK_SECRET", webhookSecret ?? "")
  }

  if (mode === "test" && keyId.startsWith("rzp_live_")) {
    throw new RazorpayConfigError({
      code: "RAZORPAY_CONFIG_MODE_MISMATCH",
      reason: "PAYMENTS_MODE=test cannot use rzp_live_ key.",
      details: {
        mode,
        key_prefix: "rzp_live_",
      },
    })
  }

  if (mode === "live" && keyId.startsWith("rzp_test_")) {
    throw new RazorpayConfigError({
      code: "RAZORPAY_CONFIG_MODE_MISMATCH",
      reason: "PAYMENTS_MODE=live cannot use rzp_test_ key.",
      details: {
        mode,
        key_prefix: "rzp_test_",
      },
    })
  }

  return {
    mode,
    keyId,
    keySecret,
    webhookSecret,
  }
}
