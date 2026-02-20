import { setTimeout as delay } from "timers/promises"
import Razorpay from "razorpay"
import { logEvent } from "../logging/log-event"
import { type RazorpayConfig, validateRazorpayConfig } from "./config"

const MAX_RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 200
const RETRY_JITTER_MS = 125

export type RazorpayClient = {
  orders: {
    create: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
  payments: {
    fetch: (paymentId: string) => Promise<Record<string, unknown>>
    capture: (
      paymentId: string,
      amount: number | string,
      currency: string
    ) => Promise<Record<string, unknown>>
    refund: (
      paymentId: string,
      params: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
  }
}

type RazorpayClientInput = Pick<RazorpayConfig, "keyId" | "keySecret">

export type RazorpayRequestMeta = {
  correlation_id: string
  endpoint: string
  scopeOrLogger?: unknown
}

type RazorpayRequestRuntime = {
  maxAttempts?: number
  random?: () => number
  sleep?: (ms: number) => Promise<void>
  shouldRetry?: (input: {
    attempt: number
    status?: number
    error: unknown
  }) => boolean
}

type RazorpayApiCallErrorInput = {
  code: string
  message: string
  http_status: number
  endpoint: string
  correlation_id: string
  sanitized_upstream: Record<string, unknown>
}

let cachedClient:
  | {
      cacheKey: string
      client: RazorpayClient
    }
  | undefined

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value)
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed)
    }
  }

  return undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    return {}
  }

  const output: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (/secret|token|password|authorization|api[_-]?key|cookie/i.test(key)) {
      output[key] = "[REDACTED]"
      continue
    }

    const normalized = readText(raw)
    output[key] = normalized || String(raw)
  }

  return output
}

function sanitizeUpstream(error: unknown): Record<string, unknown> {
  if (!isObject(error)) {
    return {
      message: error instanceof Error ? error.message : "Unknown upstream error",
    }
  }

  const statusCode = toPositiveInt(error.statusCode ?? error.status)
  const nested = isObject(error.error) ? error.error : {}
  const sanitized: Record<string, unknown> = {
    status: statusCode ?? null,
    code: readText(error.code) || readText(nested.code) || null,
    description:
      readText((error as Record<string, unknown>).description) ||
      readText(nested.description) ||
      readText(error.message) ||
      null,
    reason: readText(nested.reason) || null,
    source: readText(nested.source) || null,
    step: readText(nested.step) || null,
    field: readText(nested.field) || null,
  }

  if (isObject(nested.metadata)) {
    sanitized.metadata = sanitizeMetadata(nested.metadata)
  }

  return sanitized
}

function readErrorStatus(error: unknown): number | undefined {
  if (!isObject(error)) {
    return undefined
  }

  const direct = toPositiveInt(error.statusCode ?? error.status)
  if (direct && direct > 0) {
    return direct
  }

  if (isObject(error.error)) {
    const nested = toPositiveInt(error.error.statusCode ?? error.error.status)
    if (nested && nested > 0) {
      return nested
    }
  }

  if (isObject(error.response)) {
    const responseStatus = toPositiveInt(error.response.status)
    if (responseStatus && responseStatus > 0) {
      return responseStatus
    }
  }

  return undefined
}

function isRetryableStatus(status?: number): boolean {
  return status === 429 || (typeof status === "number" && status >= 500)
}

function computeBackoffMs(
  attempt: number,
  random: () => number = Math.random
): number {
  const base = RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1))
  const jitter = Math.floor(random() * RETRY_JITTER_MS)
  return base + jitter
}

export class RazorpayApiCallError extends Error {
  code: string
  http_status: number
  endpoint: string
  correlation_id: string
  sanitized_upstream: Record<string, unknown>

  constructor(input: RazorpayApiCallErrorInput) {
    super(input.message)
    this.name = "RazorpayApiCallError"
    this.code = input.code
    this.http_status = input.http_status
    this.endpoint = input.endpoint
    this.correlation_id = input.correlation_id
    this.sanitized_upstream = input.sanitized_upstream
  }
}

function resolveClientInput(input?: RazorpayClientInput): RazorpayClientInput {
  if (input?.keyId && input?.keySecret) {
    return input
  }

  const validated = validateRazorpayConfig(process.env)
  return {
    keyId: validated.keyId,
    keySecret: validated.keySecret,
  }
}

export function getRazorpayClient(input?: RazorpayClientInput): RazorpayClient {
  const resolved = resolveClientInput(input)
  const cacheKey = `${resolved.keyId}:${resolved.keySecret}`

  if (cachedClient?.cacheKey === cacheKey) {
    return cachedClient.client
  }

  const client = new Razorpay({
    key_id: resolved.keyId,
    key_secret: resolved.keySecret,
  }) as unknown as RazorpayClient

  cachedClient = {
    cacheKey,
    client,
  }

  return client
}

export function __unsafeResetRazorpayClientForTests(): void {
  cachedClient = undefined
}

export async function razorpayRequest<T>(
  call: () => Promise<T>,
  meta: RazorpayRequestMeta,
  runtime: RazorpayRequestRuntime = {}
): Promise<T> {
  const maxAttempts = runtime.maxAttempts ?? MAX_RETRY_ATTEMPTS
  const sleep = runtime.sleep ?? (async (ms: number) => delay(ms))
  const random = runtime.random ?? Math.random
  const shouldRetry = runtime.shouldRetry

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await call()
    } catch (error) {
      lastError = error
      const status = readErrorStatus(error)
      const retryable = status === undefined || isRetryableStatus(status)
      const allowedByPolicy = shouldRetry
        ? shouldRetry({
            attempt,
            status,
            error,
          })
        : true

      if (retryable && allowedByPolicy && attempt < maxAttempts) {
        await sleep(computeBackoffMs(attempt, random))
        continue
      }

      const sanitizedUpstream = sanitizeUpstream(error)
      const httpStatus = status ?? 502
      const description =
        readText(sanitizedUpstream.description) ||
        readText(sanitizedUpstream.reason) ||
        readText(sanitizedUpstream.code) ||
        `HTTP ${httpStatus}`

      logEvent(
        "RAZORPAY_API_CALL_FAILED",
        {
          endpoint: meta.endpoint,
          status: httpStatus,
          correlation_id: meta.correlation_id,
        },
        meta.correlation_id,
        {
          level: "error",
          scopeOrLogger: meta.scopeOrLogger,
        }
      )

      throw new RazorpayApiCallError({
        code: "RAZORPAY_API_CALL_FAILED",
        message: `Razorpay API request failed: ${description}`,
        http_status: httpStatus,
        endpoint: meta.endpoint,
        correlation_id: meta.correlation_id,
        sanitized_upstream: sanitizedUpstream,
      })
    }
  }

  const fallbackSanitized = sanitizeUpstream(lastError)
  throw new RazorpayApiCallError({
    code: "RAZORPAY_API_CALL_FAILED",
    message: "Razorpay API request failed.",
    http_status: 502,
    endpoint: meta.endpoint,
    correlation_id: meta.correlation_id,
    sanitized_upstream: fallbackSanitized,
  })
}
