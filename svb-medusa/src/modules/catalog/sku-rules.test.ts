import { CRB_SKU_REGEX } from "./sku-rules"

describe("CRB_SKU_REGEX", () => {
  it("should accept: SVB-CRB-SWFP-WHT-P01", () => {
    expect(CRB_SKU_REGEX.test("SVB-CRB-SWFP-WHT-P01")).toBe(true)
  })

  it("should reject: SVB-CRB-XXXX-WHT-P01", () => {
    expect(CRB_SKU_REGEX.test("SVB-CRB-XXXX-WHT-P01")).toBe(false)
  })
})
