import {
  enforcePriceIntegrity,
  PriceIntegrityError,
} from "../price-integrity"

describe("enforcePriceIntegrity", () => {
  it("passes for normal totals", () => {
    expect(() =>
      enforcePriceIntegrity({
        subtotal: 2000,
        shipping_total: 100,
        original_shipping_total: 100,
        discount_total: 200,
        grand_total: 1900,
      })
    ).not.toThrow()
  })

  it("throws PRICE_INTEGRITY_VIOLATION when grand_total is negative", () => {
    try {
      enforcePriceIntegrity({
        subtotal: 2000,
        shipping_total: 100,
        original_shipping_total: 100,
        discount_total: 200,
        grand_total: -1,
      })
      throw new Error("Expected integrity check to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(PriceIntegrityError)
      expect((error as { code?: string }).code).toBe("PRICE_INTEGRITY_VIOLATION")
    }
  })

  it("throws PRICE_INTEGRITY_VIOLATION when discount exceeds subtotal", () => {
    try {
      enforcePriceIntegrity({
        subtotal: 2000,
        shipping_total: 100,
        original_shipping_total: 100,
        discount_total: 2101,
        grand_total: 0,
      })
      throw new Error("Expected integrity check to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(PriceIntegrityError)
      expect((error as { code?: string }).code).toBe("PRICE_INTEGRITY_VIOLATION")
    }
  })
})
