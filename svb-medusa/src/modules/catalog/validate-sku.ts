import { CRB_SKU_REGEX } from "./sku-rules"

export type SkuValidationResult =
  | { ok: true }
  | { ok: false; error_code: string; message: string }

export function validateSku(sku: string): SkuValidationResult {
  const value = (sku ?? "").trim()

  if (!value) {
    return {
      ok: false,
      error_code: "SKU_EMPTY",
      message: "SKU is required.",
    }
  }

  if (!CRB_SKU_REGEX.test(value)) {
    return {
      ok: false,
      error_code: "SKU_INVALID_FORMAT",
      message: "SKU must match the SVB cricket ball SKU format.",
    }
  }

  return { ok: true }
}
