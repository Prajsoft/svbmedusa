import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  getCorrelationContext,
  resolveCorrelationId,
  setCorrelationContext,
} from "./correlation"

type StructuredLogLevel = "debug" | "info" | "warn" | "error"

type LoggerLike = {
  info?: (message: string) => void
  warn?: (message: string) => void
  error?: (message: string) => void
  debug?: (message: string) => void
}

type ScopeLike = {
  resolve?: (key: string) => unknown
}

type StructuredLogInput = {
  correlation_id?: string
  workflow_name?: string
  step_name?: string
  cart_id?: string
  order_id?: string
  return_id?: string
  error_code?: string
  meta?: Record<string, unknown>
}

const RESERVED_KEYS = new Set([
  "correlation_id",
  "workflow_name",
  "step_name",
  "cart_id",
  "order_id",
  "return_id",
  "error_code",
  "meta",
])

const SECRET_KEY_PATTERN =
  /(secret|token|password|authorization|cookie|api[_-]?key|private[_-]?key)/i
const ADDRESS_KEY_PATTERN = /address/i

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (depth > 3) {
    return "[TRUNCATED]"
  }

  if (typeof value === "string") {
    return value.length > 300 ? `${value.slice(0, 300)}...` : value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1))
  }

  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {}

    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (SECRET_KEY_PATTERN.test(key) || ADDRESS_KEY_PATTERN.test(key)) {
        continue
      }

      sanitized[key] = sanitizeValue(nestedValue, depth + 1)
    }

    return sanitized
  }

  return String(value)
}

function resolveLogger(scopeOrLogger?: ScopeLike | LoggerLike): LoggerLike | undefined {
  if (!scopeOrLogger) {
    return undefined
  }

  if (
    typeof (scopeOrLogger as LoggerLike).info === "function" ||
    typeof (scopeOrLogger as LoggerLike).warn === "function" ||
    typeof (scopeOrLogger as LoggerLike).error === "function"
  ) {
    return scopeOrLogger as LoggerLike
  }

  if (typeof (scopeOrLogger as ScopeLike).resolve !== "function") {
    return undefined
  }

  const scope = scopeOrLogger as ScopeLike
  try {
    return (scope.resolve?.(ContainerRegistrationKeys.LOGGER) ||
      scope.resolve?.("logger")) as LoggerLike
  } catch {
    return undefined
  }
}

function buildMeta(input: StructuredLogInput): Record<string, unknown> | undefined {
  const mergedMeta: Record<string, unknown> = {
    ...(input.meta ?? {}),
  }

  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_KEYS.has(key)) {
      continue
    }

    mergedMeta[key] = value
  }

  const sanitized = sanitizeValue(mergedMeta) as Record<string, unknown>
  if (!sanitized || Object.keys(sanitized).length === 0) {
    return undefined
  }

  return sanitized
}

function toPayload(
  level: StructuredLogLevel,
  message: string,
  input: StructuredLogInput
): Record<string, unknown> {
  const context = getCorrelationContext()
  const correlationId = resolveCorrelationId(
    input.correlation_id ?? context?.correlation_id
  )

  const workflowName = normalizeString(
    input.workflow_name ?? context?.workflow_name
  )
  const stepName = normalizeString(input.step_name ?? context?.step_name)
  const cartId = normalizeString(input.cart_id ?? context?.cart_id)
  const orderId = normalizeString(input.order_id ?? context?.order_id)
  const returnId = normalizeString(input.return_id ?? context?.return_id)
  const errorCode = normalizeString(input.error_code)

  setCorrelationContext({
    correlation_id: correlationId,
    workflow_name: workflowName,
    step_name: stepName,
    cart_id: cartId,
    order_id: orderId,
    return_id: returnId,
  })

  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    correlation_id: correlationId,
  }

  if (workflowName) {
    payload.workflow_name = workflowName
  }
  if (stepName) {
    payload.step_name = stepName
  }
  if (cartId) {
    payload.cart_id = cartId
  }
  if (orderId) {
    payload.order_id = orderId
  }
  if (returnId) {
    payload.return_id = returnId
  }
  if (errorCode) {
    payload.error_code = errorCode
  }

  const meta = buildMeta(input)
  if (meta) {
    payload.meta = meta
  }

  return payload
}

export function logStructured(
  scopeOrLogger: ScopeLike | LoggerLike | undefined,
  level: StructuredLogLevel,
  message: string,
  input: StructuredLogInput = {}
): Record<string, unknown> {
  const payload = toPayload(level, message, input)
  const serialized = JSON.stringify(payload)
  const logger = resolveLogger(scopeOrLogger)

  if (logger && typeof logger[level] === "function") {
    ;(logger[level] as (line: string) => void)(serialized)
    return payload
  }

  if (logger && typeof logger.info === "function") {
    logger.info(serialized)
    return payload
  }

  if (level === "error") {
    console.error(serialized)
    return payload
  }

  if (level === "warn") {
    console.warn(serialized)
    return payload
  }

  if (level === "debug") {
    console.debug(serialized)
    return payload
  }

  console.log(serialized)
  return payload
}
