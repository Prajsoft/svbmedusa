export const FEED_DISABLED = "FEED_DISABLED" as const
export const UNAUTHORIZED = "UNAUTHORIZED" as const
export const INVALID_QUERY = "INVALID_QUERY" as const

export type ProductFeedErrorCode =
  | typeof FEED_DISABLED
  | typeof UNAUTHORIZED
  | typeof INVALID_QUERY

export type ProductFeedErrorResponse = {
  error: {
    code: ProductFeedErrorCode
    message: string
  }
}

export class ProductFeedError extends Error {
  code: ProductFeedErrorCode
  httpStatus: number

  constructor(code: ProductFeedErrorCode, message: string, httpStatus: number) {
    super(message)
    this.name = "ProductFeedError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

export function feedDisabledError(
  message = "The product feed endpoint is disabled."
): ProductFeedError {
  return new ProductFeedError(FEED_DISABLED, message, 404)
}

export function unauthorizedFeedError(
  message = "A valid product feed token is required."
): ProductFeedError {
  return new ProductFeedError(UNAUTHORIZED, message, 401)
}

export function invalidFeedQueryError(
  message = "The product feed request query is invalid."
): ProductFeedError {
  return new ProductFeedError(INVALID_QUERY, message, 400)
}

export function toProductFeedErrorResponse(error: unknown): {
  status: number
  body: ProductFeedErrorResponse
} {
  if (error instanceof ProductFeedError) {
    return {
      status: error.httpStatus,
      body: {
        error: {
          code: error.code,
          message: error.message,
        },
      },
    }
  }

  return {
    status: 400,
    body: {
      error: {
        code: INVALID_QUERY,
        message: "The product feed request could not be processed.",
      },
    },
  }
}
