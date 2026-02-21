describe("medusa-config shipping guardrails", () => {
  const originalEnv = { ...process.env }
  let consoleErrorSpy: jest.SpyInstance
  let consoleWarnSpy: jest.SpyInstance

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.ENABLE_RAZORPAY = "false"
    delete process.env.RAZORPAY_KEY_ID
    delete process.env.RAZORPAY_KEY_SECRET
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    jest.resetModules()
  })

  function bootMedusaConfig() {
    let loaded: Record<string, unknown> | undefined
    jest.isolateModules(() => {
      loaded = require("../../medusa-config") as Record<string, unknown>
    })

    return (loaded?.default ?? loaded) as Record<string, any>
  }

  it("fails fast when SHIPPING_PROVIDER_DEFAULT=shiprocket and credentials are missing", () => {
    process.env.SHIPPING_PROVIDER_DEFAULT = "shiprocket"
    delete process.env.SHIPROCKET_TOKEN
    delete process.env.SHIPROCKET_SELLER_EMAIL
    delete process.env.SHIPROCKET_SELLER_PASSWORD
    delete process.env.SHIPROCKET_EMAIL
    delete process.env.SHIPROCKET_PASSWORD

    expect(() => bootMedusaConfig()).toThrow("PROVIDER_CONFIG_MISSING")
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "SHIPPING_PROVIDER_CONFIG_INVALID",
        reason: "PROVIDER_CONFIG_MISSING",
      })
    )
  })

  it("fails fast when CARRIER_ADAPTER=shiprocket and credentials are missing", () => {
    process.env.SHIPPING_PROVIDER_DEFAULT = "fake"
    process.env.CARRIER_ADAPTER = "shiprocket"
    delete process.env.SHIPROCKET_TOKEN
    delete process.env.SHIPROCKET_SELLER_EMAIL
    delete process.env.SHIPROCKET_SELLER_PASSWORD
    delete process.env.SHIPROCKET_EMAIL
    delete process.env.SHIPROCKET_PASSWORD

    expect(() => bootMedusaConfig()).toThrow("PROVIDER_CONFIG_MISSING")
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "SHIPPING_PROVIDER_CONFIG_INVALID",
        reason: "PROVIDER_CONFIG_MISSING",
      })
    )
  })

  it("logs WEBHOOK_SECURITY_DEGRADED on boot when ALLOW_UNSIGNED_WEBHOOKS=true", () => {
    process.env.SHIPPING_PROVIDER_DEFAULT = "fake"
    process.env.ALLOW_UNSIGNED_WEBHOOKS = "true"

    const loaded = bootMedusaConfig()
    expect(loaded).toBeTruthy()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "WEBHOOK_SECURITY_DEGRADED",
      })
    )
  })

  it("fails fast when Shiprocket is selected but SHIPROCKET_WEBHOOK_TOKEN is missing", () => {
    process.env.SHIPPING_PROVIDER_DEFAULT = "shiprocket"
    process.env.SHIPROCKET_SELLER_EMAIL = "ops@svb.test"
    process.env.SHIPROCKET_SELLER_PASSWORD = "password_123"
    process.env.ALLOW_UNSIGNED_WEBHOOKS = "false"
    delete process.env.SHIPROCKET_WEBHOOK_TOKEN

    expect(() => bootMedusaConfig()).toThrow("PROVIDER_CONFIG_MISSING")
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "SHIPPING_PROVIDER_CONFIG_INVALID",
        reason: "PROVIDER_CONFIG_MISSING",
      })
    )
  })
})
