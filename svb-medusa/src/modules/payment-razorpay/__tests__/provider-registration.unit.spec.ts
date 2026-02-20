import {
  RazorpayProviderRegistrationError,
  assertRazorpayProviderRegistered,
} from "../provider-registration"

describe("Razorpay provider registration guard", () => {
  it("passes when razorpay provider is present", () => {
    expect(() =>
      assertRazorpayProviderRegistered([
        { id: "cod" },
        { id: "razorpay" },
      ])
    ).not.toThrow()
  })

  it("throws explicit code when razorpay provider is missing", () => {
    expect(() =>
      assertRazorpayProviderRegistered([{ id: "cod" }])
    ).toThrowError(
      expect.objectContaining<RazorpayProviderRegistrationError>({
        code: "RAZORPAY_PROVIDER_REGISTRATION_FAILED",
      })
    )
  })
})
