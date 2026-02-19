import { Modules } from "@medusajs/framework/utils"
import { resolveCorrelationId, setCorrelationContext } from "../logging/correlation"
import { logStructured } from "../logging/structured-logger"
import {
  internalError,
  validationError,
} from "./errors"
import { OBSERVABILITY_MODULE } from "./index"

type ScopeLike = {
  resolve: (key: string) => any
}

type ObservabilityServiceLike = {
  createBusinessEvents: (input: Record<string, unknown>) => Promise<unknown>
  listBusinessEvents: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<unknown>
}

type BusinessEventActorType = "admin" | "customer" | "system"

export type BusinessEntityRef = {
  type: string
  id: string
}

export type BusinessEventActor =
  | BusinessEventActorType
  | {
      type: BusinessEventActorType
      id?: string
    }

export type EmitBusinessEventMeta = {
  correlation_id?: string
  actor?: BusinessEventActor
  entity_refs?: BusinessEntityRef[]
  schema_version?: string
  scope: ScopeLike
  workflow_name?: string
  step_name?: string
}

export type PersistedBusinessEvent = {
  id?: string
  name: string
  payload: Record<string, unknown>
  correlation_id: string
  created_at: string
  entity_refs: BusinessEntityRef[]
  actor: {
    type: BusinessEventActorType
    id?: string
  }
  schema_version: string
}

type AuditTimelineOptions = {
  scope: ScopeLike
  limit?: number
}

const DEFAULT_SCHEMA_VERSION = "v1"
const DEFAULT_TIMELINE_LIMIT = 1000

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeActor(
  value: BusinessEventActor | undefined
): PersistedBusinessEvent["actor"] {
  if (!value) {
    return { type: "system" }
  }

  if (typeof value === "string") {
    const type = value.trim().toLowerCase()
    if (type === "admin" || type === "customer" || type === "system") {
      return { type: type as BusinessEventActorType }
    }

    return { type: "system" }
  }

  const type = value.type?.trim().toLowerCase()
  const actorType: BusinessEventActorType =
    type === "admin" || type === "customer" || type === "system"
      ? (type as BusinessEventActorType)
      : "system"

  return {
    type: actorType,
    id: normalizeString(value.id),
  }
}

function normalizeEntityRefs(
  refs: BusinessEntityRef[] | undefined,
  payload: Record<string, unknown>
): BusinessEntityRef[] {
  const normalized: BusinessEntityRef[] = []
  const pushUnique = (type: string, id: string) => {
    const normalizedType = normalizeString(type)?.toLowerCase()
    const normalizedId = normalizeString(id)

    if (!normalizedType || !normalizedId) {
      return
    }

    if (
      normalized.some(
        (ref) => ref.type === normalizedType && ref.id === normalizedId
      )
    ) {
      return
    }

    normalized.push({
      type: normalizedType,
      id: normalizedId,
    })
  }

  for (const ref of refs ?? []) {
    if (!ref || typeof ref !== "object") {
      continue
    }

    pushUnique(ref.type, ref.id)
  }

  const payloadRefMap: Array<{ key: string; type: string }> = [
    { key: "order_id", type: "order" },
    { key: "cart_id", type: "cart" },
    { key: "return_id", type: "return" },
    { key: "exchange_id", type: "exchange" },
    { key: "rto_id", type: "rto" },
  ]

  for (const entry of payloadRefMap) {
    const raw = payload[entry.key]
    if (typeof raw === "string") {
      pushUnique(entry.type, raw)
    }
  }

  return normalized
}

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

function toEventArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((entry) => !!entry && typeof entry === "object") as Record<
      string,
      unknown
    >[]
  }

  if (
    value &&
    typeof value === "object" &&
    "data" in value &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return ((value as { data: unknown[] }).data ?? []).filter(
      (entry) => !!entry && typeof entry === "object"
    ) as Record<string, unknown>[]
  }

  return []
}

function toDateMs(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime()
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function normalizePersistedEvent(
  value: Record<string, unknown> | undefined
): PersistedBusinessEvent | undefined {
  if (!value) {
    return undefined
  }

  const payload =
    value.payload && typeof value.payload === "object" && !Array.isArray(value.payload)
      ? (value.payload as Record<string, unknown>)
      : {}

  const entityRefs = Array.isArray(value.entity_refs)
    ? normalizeEntityRefs(value.entity_refs as BusinessEntityRef[], payload)
    : normalizeEntityRefs([], payload)

  const actor = normalizeActor(
    value.actor as BusinessEventActor | undefined
  )

  const createdAtRaw = value.created_at
  const createdAt =
    createdAtRaw instanceof Date
      ? createdAtRaw.toISOString()
      : normalizeString(createdAtRaw) ?? new Date().toISOString()

  return {
    id: normalizeString(value.id),
    name: normalizeString(value.name) ?? "unknown",
    payload,
    correlation_id: normalizeString(value.correlation_id) ?? "",
    created_at: createdAt,
    entity_refs: entityRefs,
    actor,
    schema_version:
      normalizeString(value.schema_version) ?? DEFAULT_SCHEMA_VERSION,
  }
}

function hasEntityRef(
  event: PersistedBusinessEvent,
  type: string,
  id: string
): boolean {
  const normalizedType = type.trim().toLowerCase()
  const normalizedId = id.trim()

  return event.entity_refs.some(
    (ref) =>
      ref.type.trim().toLowerCase() === normalizedType &&
      ref.id.trim() === normalizedId
  )
}

function resolveObservabilityService(scope: ScopeLike): ObservabilityServiceLike {
  try {
    return scope.resolve(OBSERVABILITY_MODULE) as ObservabilityServiceLike
  } catch (error) {
    throw internalError(
      "OBSERVABILITY_SERVICE_UNAVAILABLE",
      "Observability service is not registered.",
      { cause: error }
    )
  }
}

function getEntityId(refs: BusinessEntityRef[], type: string): string | undefined {
  const normalizedType = type.trim().toLowerCase()
  const match = refs.find((ref) => ref.type === normalizedType)
  return match?.id
}

export async function emitBusinessEvent(
  name: string,
  payload: Record<string, unknown>,
  meta: EmitBusinessEventMeta
): Promise<PersistedBusinessEvent> {
  const eventName = normalizeString(name)
  if (!eventName) {
    throw validationError("EVENT_NAME_REQUIRED", "Business event name is required.")
  }

  const payloadObject =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : undefined
  if (!payloadObject) {
    throw validationError(
      "EVENT_PAYLOAD_INVALID",
      "Business event payload must be an object."
    )
  }

  if (!meta?.scope) {
    throw internalError(
      "EVENT_SCOPE_REQUIRED",
      "Business event emission requires a request scope."
    )
  }

  const correlationId = resolveCorrelationId(
    meta.correlation_id ?? payloadObject.correlation_id
  )
  const entityRefs = normalizeEntityRefs(meta.entity_refs, payloadObject)
  const actor = normalizeActor(meta.actor)
  const schemaVersion =
    normalizeString(meta.schema_version) ?? DEFAULT_SCHEMA_VERSION
  const payloadWithCorrelation = {
    ...payloadObject,
    correlation_id: correlationId,
  }

  setCorrelationContext({
    correlation_id: correlationId,
    workflow_name: normalizeString(meta.workflow_name),
    step_name: normalizeString(meta.step_name),
    cart_id: getEntityId(entityRefs, "cart"),
    order_id: getEntityId(entityRefs, "order"),
    return_id: getEntityId(entityRefs, "return"),
  })

  const observabilityService = resolveObservabilityService(meta.scope)
  const created = await observabilityService.createBusinessEvents({
    name: eventName,
    payload: payloadWithCorrelation,
    correlation_id: correlationId,
    entity_refs: entityRefs,
    actor,
    schema_version: schemaVersion,
  })

  const persisted =
    normalizePersistedEvent(first(created as any)) ??
    normalizePersistedEvent(
      (created as Record<string, unknown>) ?? {
        name: eventName,
        payload: payloadWithCorrelation,
        correlation_id: correlationId,
        entity_refs: entityRefs,
        actor,
        schema_version: schemaVersion,
      }
    )

  if (!persisted) {
    throw internalError(
      "EVENT_PERSISTENCE_FAILED",
      `Failed to persist business event ${eventName}.`
    )
  }

  const eventBus = meta.scope.resolve(Modules.EVENT_BUS)
  await eventBus.emit({
    name: eventName,
    data: payloadWithCorrelation,
  })

  logStructured(meta.scope, "info", `Business event emitted: ${eventName}`, {
    correlation_id: correlationId,
    workflow_name: meta.workflow_name,
    step_name: meta.step_name,
    cart_id: getEntityId(entityRefs, "cart"),
    order_id: getEntityId(entityRefs, "order"),
    return_id: getEntityId(entityRefs, "return"),
  })

  return persisted
}

async function listPersistedEvents(
  options: AuditTimelineOptions
): Promise<PersistedBusinessEvent[]> {
  const service = resolveObservabilityService(options.scope)
  const raw = await service.listBusinessEvents({})
  const timeline = toEventArray(raw)
    .map((entry) => normalizePersistedEvent(entry))
    .filter(Boolean) as PersistedBusinessEvent[]

  timeline.sort(
    (a, b) => toDateMs(a.created_at) - toDateMs(b.created_at)
  )

  const limit =
    typeof options.limit === "number" && options.limit > 0
      ? options.limit
      : DEFAULT_TIMELINE_LIMIT

  if (timeline.length <= limit) {
    return timeline
  }

  return timeline.slice(timeline.length - limit)
}

export async function getAuditTimelineForOrder(
  orderId: string,
  options: AuditTimelineOptions
): Promise<PersistedBusinessEvent[]> {
  const normalizedOrderId = normalizeString(orderId)
  if (!normalizedOrderId) {
    throw validationError("ORDER_ID_REQUIRED", "orderId is required.")
  }

  const timeline = await listPersistedEvents(options)
  return timeline.filter((event) =>
    hasEntityRef(event, "order", normalizedOrderId)
  )
}

export async function getAuditTimelineForReturn(
  returnId: string,
  options: AuditTimelineOptions
): Promise<PersistedBusinessEvent[]> {
  const normalizedReturnId = normalizeString(returnId)
  if (!normalizedReturnId) {
    throw validationError("RETURN_ID_REQUIRED", "returnId is required.")
  }

  const timeline = await listPersistedEvents(options)
  return timeline.filter((event) =>
    hasEntityRef(event, "return", normalizedReturnId)
  )
}
