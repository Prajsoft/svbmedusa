import {
  RazorpayConfigError,
  validateRazorpayConfig,
} from "../config"

describe("validateRazorpayConfig", () => {
  it("throws RAZORPAY_CONFIG_MISSING when RAZORPAY_KEY_ID is missing", () => {
    expect.assertions(2)

    try {
      validateRazorpayConfig({
        PAYMENTS_MODE: "test",
        RAZORPAY_KEY_SECRET: "secret",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(RazorpayConfigError)
      expect((error as RazorpayConfigError).code).toBe("RAZORPAY_CONFIG_MISSING")
    }
  })

  it("throws RAZORPAY_CONFIG_MODE_MISMATCH when PAYMENTS_MODE=test uses live key", () => {
    expect.assertions(2)

    try {
      validateRazorpayConfig({
        PAYMENTS_MODE: "test",
        RAZORPAY_KEY_ID: "rzp_live_123",
        RAZORPAY_KEY_SECRET: "secret",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(RazorpayConfigError)
      expect((error as RazorpayConfigError).code).toBe("RAZORPAY_CONFIG_MODE_MISMATCH")
    }
  })

  it("throws RAZORPAY_CONFIG_MODE_MISMATCH when PAYMENTS_MODE=live uses test key", () => {
    expect.assertions(2)

    try {
      validateRazorpayConfig({
        PAYMENTS_MODE: "live",
        RAZORPAY_KEY_ID: "rzp_test_123",
        RAZORPAY_KEY_SECRET: "secret",
        RAZORPAY_WEBHOOK_SECRET: "whsec_live_1",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(RazorpayConfigError)
      expect((error as RazorpayConfigError).code).toBe("RAZORPAY_CONFIG_MODE_MISMATCH")
    }
  })

  it("throws RAZORPAY_CONFIG_MISSING when PAYMENTS_MODE=live and webhook secret is missing", () => {
    expect.assertions(2)

    try {
      validateRazorpayConfig({
        PAYMENTS_MODE: "live",
        RAZORPAY_KEY_ID: "rzp_live_123",
        RAZORPAY_KEY_SECRET: "secret",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(RazorpayConfigError)
      expect((error as RazorpayConfigError).code).toBe("RAZORPAY_CONFIG_MISSING")
    }
  })
})
