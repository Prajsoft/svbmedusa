import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  feedDisabledError,
  invalidFeedQueryError,
  toProductFeedErrorResponse,
  unauthorizedFeedError,
} from "../../modules/product-feed/errors"
import { generateProductFeedWorkflow } from "../../workflows/generate-product-feed"

const ALLOWED_QUERY_KEYS = new Set(["currency_code", "country_code", "token"])
const REQUIRED_QUERY_KEYS = ["currency_code", "country_code", "token"] as const

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readQuery(req: MedusaRequest): Record<string, unknown> {
  const query = (req as { query?: unknown }).query
  return query && typeof query === "object" ? (query as Record<string, unknown>) : {}
}

function readQueryValue(query: Record<string, unknown>, key: string): string {
  const value = query[key]

  if (Array.isArray(value)) {
    return readText(value[0])
  }

  return readText(value)
}

function validateFeedQuery(req: MedusaRequest): {
  currency_code: string
  country_code: string
  token: string
} {
  const query = readQuery(req)
  const queryKeys = Object.keys(query)

  for (const key of queryKeys) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw invalidFeedQueryError(`Unsupported query parameter: ${key}.`)
    }
  }

  for (const key of REQUIRED_QUERY_KEYS) {
    if (!readQueryValue(query, key)) {
      throw invalidFeedQueryError(
        "currency_code, country_code, token are required query parameters."
      )
    }
  }

  return {
    currency_code: readQueryValue(query, "currency_code"),
    country_code: readQueryValue(query, "country_code"),
    token: readQueryValue(query, "token"),
  }
}

function readConfiguredFeedToken(): string {
  return readText(process.env.PRODUCT_FEED_TOKEN)
}

function ensureFeedEnabled(): void {
  if (readText(process.env.ENABLE_PRODUCT_FEED) !== "true") {
    throw feedDisabledError("Product feed is disabled")
  }
}

function ensureFeedToken(token: string): void {
  const expectedToken = readConfiguredFeedToken()
  if (!expectedToken || token !== expectedToken) {
    throw unauthorizedFeedError("Invalid token")
  }
}

function readRequestId(req: MedusaRequest): string {
  const reqAny = req as Record<string, unknown>
  const requestId =
    readText(reqAny.request_id) ||
    readText(reqAny.requestId) ||
    readText(reqAny.id) ||
    readText((req as any)?.get?.("x-request-id"))

  return requestId || "n/a"
}

function logRouteError(req: MedusaRequest, error: unknown): void {
  const requestId = readRequestId(req)
  const message =
    error instanceof Error ? error.message : "Unexpected product feed route error."

  const logger = (req as any)?.scope?.resolve?.(ContainerRegistrationKeys.LOGGER)
  if (logger && typeof logger.error === "function") {
    logger.error(`[product-feed] request_id=${requestId} error=${message}`)
    return
  }

  // eslint-disable-next-line no-console
  console.error(`[product-feed] request_id=${requestId} error=${message}`)
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const query = validateFeedQuery(req)
    ensureFeedEnabled()
    ensureFeedToken(query.token)

    const { result } = await generateProductFeedWorkflow(req.scope).run({
      input: {
        currency_code: query.currency_code,
        country_code: query.country_code,
      },
    })

    const xml = readText(result?.xml)
    if (!xml) {
      throw invalidFeedQueryError("Generated product feed is empty.")
    }

    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8")
    res.setHeader("Cache-Control", "public, max-age=300")
    return res.status(200).send(xml)
  } catch (error) {
    logRouteError(req, error)
    const mapped = toProductFeedErrorResponse(error)
    return res.status(mapped.status).json(mapped.body)
  }
}
