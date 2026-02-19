import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"

export const CORRELATION_ID_HEADER = "x-correlation-id"

export type CorrelationContext = {
  correlation_id: string
  workflow_name?: string
  step_name?: string
  cart_id?: string
  order_id?: string
  return_id?: string
}

const contextStore = new AsyncLocalStorage<CorrelationContext>()

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeCorrelationId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return normalizeCorrelationId(value[0])
  }

  const normalized = normalizeString(value)
  if (!normalized) {
    return undefined
  }

  const trimmed = normalized.slice(0, 128)
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    return undefined
  }

  return trimmed
}

function normalizeEntityId(value: unknown): string | undefined {
  const normalized = normalizeString(value)
  if (!normalized) {
    return undefined
  }

  return normalized.slice(0, 128)
}

export function generateCorrelationId(): string {
  return randomUUID()
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return contextStore.getStore()
}

export function resolveCorrelationId(explicit?: unknown): string {
  const fromExplicit = normalizeCorrelationId(explicit)
  if (fromExplicit) {
    return fromExplicit
  }

  const fromContext = normalizeCorrelationId(getCorrelationContext()?.correlation_id)
  if (fromContext) {
    return fromContext
  }

  return generateCorrelationId()
}

export function runWithCorrelationContext<T>(
  correlationId: unknown,
  fn: () => T
): T {
  const resolved = resolveCorrelationId(correlationId)
  return contextStore.run({ correlation_id: resolved }, fn)
}

export function setCorrelationContext(
  input: Partial<CorrelationContext>
): CorrelationContext {
  const existing = getCorrelationContext()
  const correlationId = resolveCorrelationId(
    input.correlation_id ?? existing?.correlation_id
  )

  const next: CorrelationContext = {
    correlation_id: correlationId,
    workflow_name: normalizeString(input.workflow_name ?? existing?.workflow_name),
    step_name: normalizeString(input.step_name ?? existing?.step_name),
    cart_id: normalizeEntityId(input.cart_id ?? existing?.cart_id),
    order_id: normalizeEntityId(input.order_id ?? existing?.order_id),
    return_id: normalizeEntityId(input.return_id ?? existing?.return_id),
  }

  if (existing) {
    Object.assign(existing, next)
    return existing
  }

  contextStore.enterWith(next)
  return next
}

function readHeaderValue(headers: unknown): unknown {
  if (!headers || typeof headers !== "object") {
    return undefined
  }

  const asRecord = headers as Record<string, unknown>
  return asRecord[CORRELATION_ID_HEADER] ?? asRecord["X-Correlation-Id"]
}

export function extractCorrelationIdFromRequest(req: {
  headers?: unknown
  get?: (name: string) => unknown
  correlation_id?: unknown
}): string {
  const direct = normalizeCorrelationId(req?.correlation_id)
  if (direct) {
    return direct
  }

  const fromGetter =
    typeof req?.get === "function"
      ? normalizeCorrelationId(req.get(CORRELATION_ID_HEADER))
      : undefined
  if (fromGetter) {
    return fromGetter
  }

  const fromHeaders = normalizeCorrelationId(readHeaderValue(req?.headers))
  if (fromHeaders) {
    return fromHeaders
  }

  return resolveCorrelationId()
}
