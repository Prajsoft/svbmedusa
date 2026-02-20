export const RAZORPAY_PROVIDER_ID = "razorpay"
const RAZORPAY_PROVIDER_REGISTRATION_FAILED = "RAZORPAY_PROVIDER_REGISTRATION_FAILED"

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export class RazorpayProviderRegistrationError extends Error {
  code: string
  reason: string

  constructor(reason: string) {
    super(RAZORPAY_PROVIDER_REGISTRATION_FAILED)
    this.name = "RazorpayProviderRegistrationError"
    this.code = RAZORPAY_PROVIDER_REGISTRATION_FAILED
    this.reason = reason
  }
}

export function assertRazorpayProviderRegistered(
  providers: Array<Record<string, unknown>>
): void {
  const hasRazorpay = providers.some(
    (provider) => readText(provider.id) === RAZORPAY_PROVIDER_ID
  )

  if (hasRazorpay) {
    return
  }

  throw new RazorpayProviderRegistrationError(
    "Razorpay provider is missing from payment module registration."
  )
}
