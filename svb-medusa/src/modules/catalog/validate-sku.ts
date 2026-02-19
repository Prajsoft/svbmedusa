import { CRB_SKU_REGEX } from "./sku-rules"
import { AppError, validationError } from "../observability/errors"

export type SkuValidationResult =
  | { ok: true }
  | { ok: false; error_code: string; message: string }

export class SkuValidationError extends AppError {
  constructor(code: string, message: string) {
    const appError = validationError(code, message)
    super({
      code: appError.code,
      message: appError.message,
      category: appError.category,
      httpStatus: appError.httpStatus,
      details: appError.details,
    })
    this.name = "SkuValidationError"
  }
}

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

export function assertValidSku(sku: string): void {
  const result = validateSku(sku)

  if (!result.ok) {
    throw new SkuValidationError(result.error_code, result.message)
  }
}
