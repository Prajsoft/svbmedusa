function loadPromoPolicyModule() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../promo-policy") as typeof import("../promo-policy")
}

function loadPromoGuardsModule() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../promo-guards") as typeof import("../promo-guards")
}

describe("promoPolicy", () => {
  const originalFreeShipping = process.env.PROMO_ALLOW_FREE_SHIPPING
  const originalAutoPlusManual = process.env.PROMO_ALLOW_AUTO_PLUS_MANUAL

  afterEach(() => {
    if (originalFreeShipping === undefined) {
      delete process.env.PROMO_ALLOW_FREE_SHIPPING
    } else {
      process.env.PROMO_ALLOW_FREE_SHIPPING = originalFreeShipping
    }

    if (originalAutoPlusManual === undefined) {
      delete process.env.PROMO_ALLOW_AUTO_PLUS_MANUAL
    } else {
      process.env.PROMO_ALLOW_AUTO_PLUS_MANUAL = originalAutoPlusManual
    }

    jest.resetModules()
  })

  it("defaults feature flags to false", () => {
    delete process.env.PROMO_ALLOW_FREE_SHIPPING
    delete process.env.PROMO_ALLOW_AUTO_PLUS_MANUAL
    jest.resetModules()

    const { promoPolicy } = loadPromoPolicyModule()

    expect(promoPolicy.allowFreeShipping).toBe(false)
    expect(promoPolicy.allowAutoPlusManual).toBe(false)
    expect(promoPolicy.allowMultipleManualCoupons).toBe(false)
  })
})

describe("ensureCouponStackingAllowed", () => {
  beforeEach(() => {
    process.env.PROMO_ALLOW_FREE_SHIPPING = "false"
    process.env.PROMO_ALLOW_AUTO_PLUS_MANUAL = "false"
    jest.resetModules()
  })

  it("throws COUPON_STACKING_NOT_ALLOWED when cart already has a different manual coupon", () => {
    const { ensureCouponStackingAllowed, PromoGuardError } = loadPromoGuardsModule()

    expect(() =>
      ensureCouponStackingAllowed(
        {
          discount_codes: [{ code: "SAVE10" }],
        },
        "SAVE20"
      )
    ).toThrow(PromoGuardError)

    try {
      ensureCouponStackingAllowed(
        {
          discount_codes: [{ code: "SAVE10" }],
        },
        "SAVE20"
      )
      throw new Error("Expected guard to throw")
    } catch (error) {
      expect((error as { code?: string }).code).toBe("COUPON_STACKING_NOT_ALLOWED")
    }
  })

  it("throws COUPON_STACKING_NOT_ALLOWED when auto promo exists and auto+manual is disabled", () => {
    const { ensureCouponStackingAllowed } = loadPromoGuardsModule()

    try {
      ensureCouponStackingAllowed(
        {
          promotions: [{ code: "AUTO10", is_automatic: true }],
        },
        "SAVE10"
      )
      throw new Error("Expected guard to throw")
    } catch (error) {
      expect((error as { code?: string }).code).toBe("COUPON_STACKING_NOT_ALLOWED")
    }
  })

  it("throws COUPON_INVALID when free-shipping coupon is disabled in v1", () => {
    const { ensureCouponStackingAllowed } = loadPromoGuardsModule()

    try {
      ensureCouponStackingAllowed(
        {
          discount_codes: [],
        },
        "FREESHIP100"
      )
      throw new Error("Expected guard to throw")
    } catch (error) {
      expect((error as { code?: string }).code).toBe("COUPON_INVALID")
    }
  })

  it("allows a single coupon when no stacking conflicts exist", () => {
    const { ensureCouponStackingAllowed } = loadPromoGuardsModule()

    expect(() =>
      ensureCouponStackingAllowed(
        {
          discount_codes: [{ code: "SAVE10" }],
        },
        "save10"
      )
    ).not.toThrow()
  })
})
