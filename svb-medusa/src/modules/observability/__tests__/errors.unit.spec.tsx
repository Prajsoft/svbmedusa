import {
  AppError,
  integrityError,
  internalError,
  permanentExternalError,
  toApiErrorResponse,
  toAppError,
  transientExternalError,
  validationError,
} from "../errors"

describe("AppError helpers", () => {
  it("creates validation errors with code/category/httpStatus", () => {
    const error = validationError("SKU_INVALID_FORMAT", "Invalid SKU format.")

    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe("SKU_INVALID_FORMAT")
    expect(error.category).toBe("validation")
    expect(error.httpStatus).toBe(400)
    expect(error.message).toBe("Invalid SKU format.")
  })

  it("creates integrity, transient external, permanent external and internal errors", () => {
    expect(integrityError("PRICE_INTEGRITY_VIOLATION", "Integrity failed.").category).toBe(
      "integrity"
    )
    expect(transientExternalError("CARRIER_TIMEOUT", "Carrier timeout.").httpStatus).toBe(503)
    expect(permanentExternalError("CARRIER_BAD_REQUEST", "Carrier rejected.").httpStatus).toBe(
      502
    )
    expect(internalError("INTERNAL_ERROR", "Unexpected error.").category).toBe("internal")
  })
})

describe("known error code mapping", () => {
  const requiredCodes = [
    "OUT_OF_STOCK",
    "SKU_INVALID_FORMAT",
    "MISSING_LOGISTICS_METADATA",
    "SHIPPING_OPTION_INELIGIBLE",
    "PRICE_INTEGRITY_VIOLATION",
  ] as const

  it.each(requiredCodes)("maps %s into AppError taxonomy", (code) => {
    const mapped = toAppError({
      code,
      message: `Mapped ${code}`,
    })

    expect(mapped).toBeInstanceOf(AppError)
    expect(mapped.code).toBe(code)
    expect(mapped.message).toBe(`Mapped ${code}`)
    expect(mapped.httpStatus).toBe(400)
  })

  it("maps integrity code into integrity category", () => {
    const mapped = toAppError({
      code: "PRICE_INTEGRITY_VIOLATION",
      message: "Integrity check failed.",
    })

    expect(mapped.category).toBe("integrity")
  })
})

describe("API error response formatting", () => {
  it("returns stable code + message payload for known code", () => {
    const response = toApiErrorResponse({
      code: "OUT_OF_STOCK",
      message: "Insufficient inventory.",
    })

    expect(response).toEqual({
      status: 400,
      body: {
        code: "OUT_OF_STOCK",
        message: "Insufficient inventory.",
      },
    })
  })

  it("returns internal fallback payload for unknown errors", () => {
    const response = toApiErrorResponse(new Error("database timeout"))

    expect(response.status).toBe(500)
    expect(response.body).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    })
  })
})
