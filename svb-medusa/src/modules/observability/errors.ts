export type ErrorCategory =
  | "validation"
  | "integrity"
  | "transient_external"
  | "permanent_external"
  | "internal"

type AppErrorOptions = {
  details?: Record<string, unknown>
  cause?: unknown
  httpStatus?: number
}

type AppErrorInput = {
  code: string
  message: string
  category: ErrorCategory
  httpStatus: number
  details?: Record<string, unknown>
  cause?: unknown
}

type KnownCodeDefaults = {
  category: ErrorCategory
  httpStatus: number
}

type MedusaTypeDefaults = {
  code: string
  category: ErrorCategory
  httpStatus: number
}

export type ApiErrorResponsePayload = {
  code: string
  message: string
}

export type ApiErrorResponse = {
  status: number
  body: ApiErrorResponsePayload
}

const KNOWN_ERROR_CODE_DEFAULTS: Record<string, KnownCodeDefaults> = {
  OUT_OF_STOCK: {
    category: "validation",
    httpStatus: 400,
  },
  SKU_INVALID_FORMAT: {
    category: "validation",
    httpStatus: 400,
  },
  MISSING_LOGISTICS_METADATA: {
    category: "validation",
    httpStatus: 400,
  },
  SHIPPING_OPTION_INELIGIBLE: {
    category: "validation",
    httpStatus: 400,
  },
  PRICE_INTEGRITY_VIOLATION: {
    category: "integrity",
    httpStatus: 400,
  },
}

const MEDUSA_ERROR_TYPE_DEFAULTS: Record<string, MedusaTypeDefaults> = {
  invalid_data: {
    code: "INVALID_DATA",
    category: "validation",
    httpStatus: 400,
  },
  invalid_argument: {
    code: "INVALID_ARGUMENT",
    category: "validation",
    httpStatus: 400,
  },
  duplicate_error: {
    code: "DUPLICATE_ERROR",
    category: "integrity",
    httpStatus: 409,
  },
  conflict: {
    code: "CONFLICT",
    category: "integrity",
    httpStatus: 409,
  },
  unexpected_state: {
    code: "UNEXPECTED_STATE",
    category: "integrity",
    httpStatus: 409,
  },
  unauthorized: {
    code: "UNAUTHORIZED",
    category: "validation",
    httpStatus: 401,
  },
  not_allowed: {
    code: "NOT_ALLOWED",
    category: "validation",
    httpStatus: 403,
  },
  not_found: {
    code: "NOT_FOUND",
    category: "validation",
    httpStatus: 404,
  },
  payment_authorization_error: {
    code: "PAYMENT_AUTHORIZATION_ERROR",
    category: "validation",
    httpStatus: 400,
  },
  payment_requires_more_error: {
    code: "PAYMENT_REQUIRES_MORE_ERROR",
    category: "validation",
    httpStatus: 400,
  },
  database_error: {
    code: "DATABASE_ERROR",
    category: "internal",
    httpStatus: 500,
  },
  unknown_modules: {
    code: "UNKNOWN_MODULES",
    category: "internal",
    httpStatus: 500,
  },
}

function normalizeCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeMessage(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeType(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  return normalized || undefined
}

export class AppError extends Error {
  code: string
  category: ErrorCategory
  httpStatus: number
  details?: Record<string, unknown>

  constructor(input: AppErrorInput) {
    super(input.message)
    this.name = "AppError"
    this.code = input.code
    this.category = input.category
    this.httpStatus = input.httpStatus
    this.details = input.details

    if (input.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = input.cause
    }
  }
}

export function validationError(
  code: string,
  message: string,
  options: AppErrorOptions = {}
): AppError {
  return new AppError({
    code,
    message,
    category: "validation",
    httpStatus: options.httpStatus ?? 400,
    details: options.details,
    cause: options.cause,
  })
}

export function integrityError(
  code: string,
  message: string,
  options: AppErrorOptions = {}
): AppError {
  return new AppError({
    code,
    message,
    category: "integrity",
    httpStatus: options.httpStatus ?? 400,
    details: options.details,
    cause: options.cause,
  })
}

export function transientExternalError(
  code: string,
  message: string,
  options: AppErrorOptions = {}
): AppError {
  return new AppError({
    code,
    message,
    category: "transient_external",
    httpStatus: options.httpStatus ?? 503,
    details: options.details,
    cause: options.cause,
  })
}

export function permanentExternalError(
  code: string,
  message: string,
  options: AppErrorOptions = {}
): AppError {
  return new AppError({
    code,
    message,
    category: "permanent_external",
    httpStatus: options.httpStatus ?? 502,
    details: options.details,
    cause: options.cause,
  })
}

export function internalError(
  code: string,
  message: string,
  options: AppErrorOptions = {}
): AppError {
  return new AppError({
    code,
    message,
    category: "internal",
    httpStatus: options.httpStatus ?? 500,
    details: options.details,
    cause: options.cause,
  })
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

function fromKnownCode(
  code: string,
  message: string,
  details?: Record<string, unknown>
): AppError {
  const defaults = KNOWN_ERROR_CODE_DEFAULTS[code]

  if (!defaults) {
    return validationError(code, message, { details })
  }

  if (defaults.category === "integrity") {
    return integrityError(code, message, {
      details,
      httpStatus: defaults.httpStatus,
    })
  }

  return validationError(code, message, {
    details,
    httpStatus: defaults.httpStatus,
  })
}

function fromMedusaType(
  type: string,
  message: string,
  details?: Record<string, unknown>
): AppError {
  const defaults = MEDUSA_ERROR_TYPE_DEFAULTS[type]

  if (!defaults) {
    return internalError(type.toUpperCase(), message, { details })
  }

  if (defaults.category === "integrity") {
    return integrityError(defaults.code, message, {
      details,
      httpStatus: defaults.httpStatus,
    })
  }

  if (defaults.category === "internal") {
    return internalError(defaults.code, message, {
      details,
      httpStatus: defaults.httpStatus,
    })
  }

  return validationError(defaults.code, message, {
    details,
    httpStatus: defaults.httpStatus,
  })
}

export function toAppError(
  error: unknown,
  fallback: {
    code?: string
    message?: string
    httpStatus?: number
    category?: ErrorCategory
  } = {}
): AppError {
  if (isAppError(error)) {
    return error
  }

  const fallbackCode = fallback.code ?? "INTERNAL_ERROR"
  // Do NOT fall back to error.message — it may contain DB schema text or
  // stack trace fragments. Only the caller-provided message or the generic
  // string is used as the default. The raw message is still extracted below
  // for known-code / Medusa-type paths where it is intentionally included.
  const fallbackMessage = fallback.message ?? "An unexpected error occurred."
  const fallbackStatus = fallback.httpStatus ?? 500
  const fallbackCategory = fallback.category ?? "internal"

  const defaultFallback = new AppError({
    code: fallbackCode,
    message: fallbackMessage,
    category: fallbackCategory,
    httpStatus: fallbackStatus,
  })

  if (!error || typeof error !== "object") {
    return defaultFallback
  }

  const code = normalizeCode((error as { code?: unknown }).code)
  const medusaType = normalizeType((error as { type?: unknown }).type)
  const message = normalizeMessage((error as { message?: unknown }).message)
  const details =
    (error as { details?: unknown }).details &&
    typeof (error as { details?: unknown }).details === "object"
      ? ((error as { details?: Record<string, unknown> }).details ?? undefined)
      : undefined

  if (!code && medusaType) {
    return fromMedusaType(medusaType, message ?? fallbackMessage, details)
  }

  if (!code) {
    return defaultFallback
  }

  return fromKnownCode(code, message ?? fallbackMessage, details)
}

export function toApiErrorResponse(
  error: unknown,
  fallback: {
    code?: string
    message?: string
    httpStatus?: number
    category?: ErrorCategory
  } = {}
): ApiErrorResponse {
  const appError = toAppError(error, fallback)

  return {
    status: appError.httpStatus,
    body: {
      code: appError.code,
      message: appError.message,
    },
  }
}
