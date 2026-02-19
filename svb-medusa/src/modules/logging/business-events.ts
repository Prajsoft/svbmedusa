import { Modules } from "@medusajs/framework/utils"
import { resolveCorrelationId, setCorrelationContext } from "./correlation"
import { logStructured } from "./structured-logger"
import {
  emitBusinessEvent as emitPersistedBusinessEvent,
  type BusinessEntityRef,
  type BusinessEventActor,
} from "../observability/business-events"

type ScopeLike = {
  resolve: (key: string) => any
}

type EmitBusinessEventInput = {
  name: string
  data: Record<string, unknown>
  correlation_id?: string
  actor?: BusinessEventActor
  entity_refs?: BusinessEntityRef[]
  schema_version?: string
  workflow_name?: string
  step_name?: string
  cart_id?: string
  order_id?: string
  return_id?: string
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function buildEntityRefs(input: EmitBusinessEventInput): BusinessEntityRef[] {
  const refs: BusinessEntityRef[] = []

  const push = (type: string, value: unknown) => {
    const normalizedType = normalizeString(type)?.toLowerCase()
    const normalizedId = normalizeString(value)
    if (!normalizedType || !normalizedId) {
      return
    }

    if (
      refs.some(
        (entry) =>
          entry.type === normalizedType && entry.id === normalizedId
      )
    ) {
      return
    }

    refs.push({
      type: normalizedType,
      id: normalizedId,
    })
  }

  for (const ref of input.entity_refs ?? []) {
    push(ref.type, ref.id)
  }

  push("cart", input.cart_id ?? input.data.cart_id)
  push("order", input.order_id ?? input.data.order_id)
  push("return", input.return_id ?? input.data.return_id)

  return refs
}

async function emitWithoutPersistence(
  scope: ScopeLike,
  input: EmitBusinessEventInput,
  correlationId: string,
  cartId: string | undefined,
  orderId: string | undefined,
  returnId: string | undefined
): Promise<void> {
  setCorrelationContext({
    correlation_id: correlationId,
    workflow_name: normalizeString(input.workflow_name),
    step_name: normalizeString(input.step_name),
    cart_id: cartId,
    order_id: orderId,
    return_id: returnId,
  })

  const eventBus = scope.resolve(Modules.EVENT_BUS)
  await eventBus.emit({
    name: input.name,
    data: {
      ...input.data,
      correlation_id: correlationId,
    },
  })

  logStructured(scope, "warn", `Business event emitted without persistence: ${input.name}`, {
    correlation_id: correlationId,
    workflow_name: input.workflow_name,
    step_name: input.step_name,
    cart_id: cartId,
    order_id: orderId,
    return_id: returnId,
    error_code: "OBSERVABILITY_SERVICE_UNAVAILABLE",
  })
}

export async function emitBusinessEvent(
  scope: ScopeLike,
  input: EmitBusinessEventInput
): Promise<void> {
  const correlationId = resolveCorrelationId(
    input.correlation_id ?? input.data.correlation_id
  )

  const cartId = normalizeString(input.cart_id ?? input.data.cart_id)
  const orderId = normalizeString(input.order_id ?? input.data.order_id)
  const returnId = normalizeString(input.return_id ?? input.data.return_id)
  const entityRefs = buildEntityRefs(input)

  try {
    await emitPersistedBusinessEvent(input.name, input.data, {
      scope,
      correlation_id: correlationId,
      actor: input.actor,
      entity_refs: entityRefs,
      schema_version: input.schema_version,
      workflow_name: input.workflow_name,
      step_name: input.step_name,
    })
  } catch (error) {
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? ((error as { code: string }).code as string)
        : undefined

    if (code === "OBSERVABILITY_SERVICE_UNAVAILABLE") {
      await emitWithoutPersistence(
        scope,
        input,
        correlationId,
        cartId,
        orderId,
        returnId
      )
      return
    }

    throw error
  }
}
