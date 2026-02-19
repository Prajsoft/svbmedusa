import {
  validateVariantCreateBody,
  validateVariantUpdateBody,
} from "../middlewares"
import { SkuValidationError } from "../../modules/catalog/validate-sku"

describe("admin SKU enforcement", () => {
  it("rejects invalid SKU on variant create with correct code", () => {
    try {
      validateVariantCreateBody({ sku: "SVB-CRB-XXXX-WHT-P01" })
      throw new Error("Expected variant create validation to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(SkuValidationError)
      expect((error as SkuValidationError).code).toBe("SKU_INVALID_FORMAT")
      expect((error as SkuValidationError).message).toBe(
        "SKU must match the SVB cricket ball SKU format."
      )
    }
  })

  it("rejects invalid SKU on variant update with correct code", () => {
    try {
      validateVariantUpdateBody({ sku: "SVB-CRB-XXXX-WHT-P01" })
      throw new Error("Expected variant update validation to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(SkuValidationError)
      expect((error as SkuValidationError).code).toBe("SKU_INVALID_FORMAT")
      expect((error as SkuValidationError).message).toBe(
        "SKU must match the SVB cricket ball SKU format."
      )
    }
  })

  it("accepts valid SKU on variant create", () => {
    expect(() =>
      validateVariantCreateBody({ sku: "SVB-CRB-SWFP-WHT-P01" })
    ).not.toThrow()
  })

  it("accepts valid SKU on variant update", () => {
    expect(() =>
      validateVariantUpdateBody({ sku: "SVB-CRB-BLTZP-RED-P12" })
    ).not.toThrow()
  })
})
