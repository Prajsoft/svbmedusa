describe("medusa-config Razorpay guardrails", () => {
  const originalEnv = { ...process.env }
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.PAYMENT_PROVIDER_DEFAULT
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    consoleErrorSpy.mockRestore()
    jest.resetModules()
  })

  function bootMedusaConfig() {
    let loaded: Record<string, unknown> | undefined
    jest.isolateModules(() => {
      loaded = require("../../medusa-config") as Record<string, unknown>
    })

    return (loaded?.default ?? loaded) as Record<string, any>
  }

  it("logs structured config invalid event and throws on missing key id", () => {
    process.env.PAYMENTS_MODE = "test"
    process.env.ENABLE_RAZORPAY = "true"
    delete process.env.RAZORPAY_KEY_ID
    process.env.RAZORPAY_KEY_SECRET = "secret"

    expect(() => bootMedusaConfig()).toThrow("RAZORPAY_CONFIG_MISSING")
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "RAZORPAY_CONFIG_INVALID",
        reason: "RAZORPAY_CONFIG_MISSING",
      })
    )
  })

  it("crashes boot when PAYMENTS_MODE=test and key is live", () => {
    process.env.PAYMENTS_MODE = "test"
    process.env.ENABLE_RAZORPAY = "true"
    process.env.RAZORPAY_KEY_ID = "rzp_live_123"
    process.env.RAZORPAY_KEY_SECRET = "secret"

    expect(() => bootMedusaConfig()).toThrow("RAZORPAY_CONFIG_MODE_MISMATCH")
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "RAZORPAY_CONFIG_INVALID",
        reason: "RAZORPAY_CONFIG_MODE_MISMATCH",
      })
    )
  })

  it("crashes boot when PAYMENTS_MODE=live and key is test", () => {
    process.env.PAYMENTS_MODE = "live"
    process.env.ENABLE_RAZORPAY = "true"
    process.env.RAZORPAY_KEY_ID = "rzp_test_123"
    process.env.RAZORPAY_KEY_SECRET = "secret"
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_1"

    expect(() => bootMedusaConfig()).toThrow("RAZORPAY_CONFIG_MODE_MISMATCH")
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "RAZORPAY_CONFIG_INVALID",
        reason: "RAZORPAY_CONFIG_MODE_MISMATCH",
      })
    )
  })

  it("crashes boot when PAYMENTS_MODE=live and webhook secret is missing", () => {
    process.env.PAYMENTS_MODE = "live"
    process.env.ENABLE_RAZORPAY = "true"
    process.env.RAZORPAY_KEY_ID = "rzp_live_123"
    process.env.RAZORPAY_KEY_SECRET = "secret"
    delete process.env.RAZORPAY_WEBHOOK_SECRET

    expect(() => bootMedusaConfig()).toThrow("RAZORPAY_CONFIG_MISSING")
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "RAZORPAY_CONFIG_INVALID",
        reason: "RAZORPAY_CONFIG_MISSING",
      })
    )
  })

  it("registers razorpay in payment providers on boot", () => {
    process.env.PAYMENTS_MODE = "test"
    process.env.ENABLE_RAZORPAY = "true"
    process.env.RAZORPAY_KEY_ID = "rzp_test_123"
    process.env.RAZORPAY_KEY_SECRET = "secret"
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_1"

    const config = bootMedusaConfig()
    const providers = config.modules?.payment?.options?.providers ?? []

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "razorpay",
        }),
      ])
    )
  })

  it("throws explicit registration failure code when provider registration guard fails", () => {
    process.env.PAYMENTS_MODE = "test"
    process.env.ENABLE_RAZORPAY = "true"
    process.env.RAZORPAY_KEY_ID = "rzp_test_123"
    process.env.RAZORPAY_KEY_SECRET = "secret"
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_1"

    jest.isolateModules(() => {
      jest.doMock("../../src/modules/payment-razorpay/provider-registration", () => {
        const actual = jest.requireActual(
          "../../src/modules/payment-razorpay/provider-registration"
        )
        return {
          ...actual,
          assertRazorpayProviderRegistered: () => {
            throw new actual.RazorpayProviderRegistrationError("forced failure")
          },
        }
      })

      expect(() => require("../../medusa-config")).toThrow(
        "RAZORPAY_PROVIDER_REGISTRATION_FAILED"
      )
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "RAZORPAY_PROVIDER_REGISTRATION_FAILED",
      })
    )
  })

  it("crashes boot when PAYMENT_PROVIDER_DEFAULT points to an unregistered provider", () => {
    process.env.PAYMENTS_MODE = "test"
    process.env.ENABLE_RAZORPAY = "false"
    delete process.env.RAZORPAY_KEY_ID
    delete process.env.RAZORPAY_KEY_SECRET
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    process.env.PAYMENT_PROVIDER_DEFAULT = "razorpay"

    expect(() => bootMedusaConfig()).toThrow("PAYMENT_PROVIDER_DEFAULT_INVALID")
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "PAYMENT_PROVIDER_DEFAULT_INVALID",
      })
    )
  })
})
