import {
  assertValidSku,
  SkuValidationError,
  validateSku,
} from "./validate-sku"

describe("validateSku", () => {
  it('returns SKU_EMPTY for ""', () => {
    const result = validateSku("")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error_code).toBe("SKU_EMPTY")
      expect(result.message).toBe("SKU is required.")
    }
  })

  it('returns SKU_EMPTY for whitespace-only input', () => {
    const result = validateSku("   ")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error_code).toBe("SKU_EMPTY")
      expect(result.message).toBe("SKU is required.")
    }
  })

  it('returns SKU_INVALID_FORMAT for "SVB-CRB-XXXX-WHT-P01"', () => {
    const result = validateSku("SVB-CRB-XXXX-WHT-P01")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error_code).toBe("SKU_INVALID_FORMAT")
      expect(result.message).toBe("SKU must match the SVB cricket ball SKU format.")
    }
  })

  it('returns ok:true for "SVB-CRB-SWFP-WHT-P01"', () => {
    expect(validateSku("SVB-CRB-SWFP-WHT-P01")).toEqual({ ok: true })
  })

  it('returns ok:true for "SVB-CRB-BLTZP-RED-P12"', () => {
    expect(validateSku("SVB-CRB-BLTZP-RED-P12")).toEqual({ ok: true })
  })
})

describe("assertValidSku", () => {
  it("throws SkuValidationError with code SKU_INVALID_FORMAT for invalid SKU", () => {
    try {
      assertValidSku("SVB-CRB-XXXX-WHT-P01")
      throw new Error("Expected assertValidSku to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(SkuValidationError)
      expect((error as SkuValidationError).code).toBe("SKU_INVALID_FORMAT")
    }
  })

  it("does not throw for valid SKU", () => {
    expect(() => assertValidSku("SVB-CRB-SWFP-WHT-P01")).not.toThrow()
  })
})
