import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { WAREHOUSE_NAME } from "../../modules/inventory/check-availability"
import { emitBusinessEvent } from "../../modules/logging/business-events"

export type ScopeLike = {
  resolve: (key: string) => any
}

export type ReturnState =
  | "requested"
  | "approved"
  | "received"
  | "qc_passed"
  | "qc_failed"
  | "refunded"
  | "closed"

export type ReturnAction =
  | "return_request"
  | "return_approve"
  | "return_receive"
  | "return_qc_pass"
  | "return_qc_fail"
  | "return_close"

export type ReturnReasonCode =
  | "SIZE_ISSUE"
  | "DEFECTIVE"
  | "WRONG_ITEM"
  | "CHANGED_MIND"
  | "DAMAGED_IN_TRANSIT"
  | "OTHER"

export type ReturnItemInput = {
  line_item_id?: string
  variant_id?: string
  sku?: string
  quantity: number
}

export type ReturnItemRecord = {
  line_item_id: string
  variant_id: string
  sku: string
  name: string
  quantity: number
  inventory_items: Array<{
    inventory_item_id: string
    required_quantity: number
  }>
}

export type ReturnInventoryMovement = {
  mode: "to_qc_hold" | "qc_hold_to_sellable" | "qc_hold_to_damage"
  at: string
  adjustments: Array<{
    inventory_item_id: string
    location_id: string
    adjustment: number
  }>
}

type ReturnIdempotencyEntry = {
  action: ReturnAction
  at: string
  actor_id?: string
}

type ReturnHistoryEntry = {
  action: ReturnAction
  from_status: ReturnState | null
  to_status: ReturnState
  at: string
  actor_id?: string
  reason?: string
}

export type ReturnIntentRecord = {
  return_id: string
  order_id: string
  state: ReturnState
  reason_code: ReturnReasonCode
  note?: string
  items: ReturnItemRecord[]
  created_at: string
  updated_at: string
  idempotency_log: Record<string, ReturnIdempotencyEntry>
  status_history: ReturnHistoryEntry[]
  inventory_movements?: ReturnInventoryMovement[]
  refund?: {
    mode: "cod" | "prepaid"
    status: "pending" | "requested" | "recorded"
    amount: number
    reason?: string
    reference?: string
    updated_at: string
  }
}

type OrderLike = {
  id: string
  total?: number | string | null
  metadata?: Record<string, unknown> | null
  items?: Array<{
    id?: string | null
    title?: string | null
    quantity?: number | string | null
    variant?: {
      id?: string | null
      sku?: string | null
      title?: string | null
    } | null
  }>
  payment_collections?: Array<{
    payments?: Array<{
      id?: string | null
      provider_id?: string | null
      amount?: number | string | null
      currency_code?: string | null
      captured_at?: string | null
      data?: Record<string, unknown> | null
      refunds?: Array<{
        amount?: number | string | null
        note?: string | null
      }> | null
    }> | null
  }> | null
}

type VariantLike = {
  id: string
  sku?: string | null
  inventory_items?: Array<{
    inventory_item_id?: string | null
    required_quantity?: number | string | null
  }> | null
}

type StockLocationLike = {
  id: string
  name?: string | null
}

const RETURN_REASON_CODES = new Set<ReturnReasonCode>([
  "SIZE_ISSUE",
  "DEFECTIVE",
  "WRONG_ITEM",
  "CHANGED_MIND",
  "DAMAGED_IN_TRANSIT",
  "OTHER",
])

const ALLOWED_NEXT_STATE: Record<ReturnState, ReturnState[]> = {
  requested: ["approved"],
  approved: ["received"],
  received: ["qc_passed", "qc_failed"],
  qc_passed: ["refunded", "closed"],
  qc_failed: ["closed"],
  refunded: ["closed"],
  closed: [],
}

export class ReturnWorkflowError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "ReturnWorkflowError"
    this.code = code
  }
}

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(String(value))
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function toPositiveInt(value: unknown): number {
  const parsed = Math.floor(toNumber(value))
  return parsed > 0 ? parsed : 0
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase()
}

function normalizeBucketName(value: unknown): string {
  return String(value ?? "").trim().toUpperCase()
}

export function normalizeReturnId(value?: string): string {
  const normalized = (value ?? "").trim()
  return normalized || "return_1"
}

export function requireIdempotencyKey(value?: string): string {
  const normalized = (value ?? "").trim()
  if (!normalized) {
    throw new ReturnWorkflowError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "idempotency_key is required."
    )
  }

  return normalized
}

export function assertReturnReasonCode(value: string): asserts value is ReturnReasonCode {
  const normalized = normalizeCode(value)
  if (!RETURN_REASON_CODES.has(normalized as ReturnReasonCode)) {
    throw new ReturnWorkflowError(
      "INVALID_RETURN_REASON",
      `Invalid return reason code: ${value}.`
    )
  }
}

function getSellableBucketCode(): string {
  return process.env.SVB_SELLABLE_LOCATION_CODE?.trim() || WAREHOUSE_NAME
}

function getQcHoldBucketCode(): string {
  return process.env.SVB_QC_HOLD_LOCATION_CODE?.trim() || "QC_HOLD"
}

function getDamageBucketCode(): string {
  return process.env.SVB_DAMAGE_LOCATION_CODE?.trim() || "DAMAGE"
}

function getReturnIntents(
  metadata: Record<string, unknown> | null | undefined
): Record<string, ReturnIntentRecord> {
  const value = metadata?.return_intents_v1
  if (!value || typeof value !== "object") {
    return {}
  }

  return value as Record<string, ReturnIntentRecord>
}

export function getReturnIntent(
  order: { metadata?: Record<string, unknown> | null },
  returnId: string
): ReturnIntentRecord | undefined {
  return getReturnIntents(order.metadata)[returnId]
}

export function getReturnIntentOrThrow(
  order: OrderLike,
  returnId: string
): ReturnIntentRecord {
  const intent = getReturnIntent(order, returnId)
  if (!intent) {
    throw new ReturnWorkflowError(
      "RETURN_NOT_FOUND",
      `Return ${returnId} was not found for order ${order.id}.`
    )
  }

  return intent
}

function buildUpdatedMetadata(
  order: OrderLike,
  intent: ReturnIntentRecord
): Record<string, unknown> {
  const currentMetadata =
    order.metadata && typeof order.metadata === "object" ? order.metadata : {}
  const intents = getReturnIntents(currentMetadata)

  return {
    ...currentMetadata,
    return_state_v1: intent.state,
    return_intents_v1: {
      ...intents,
      [intent.return_id]: intent,
    },
  }
}

export async function persistReturnIntent(
  scope: ScopeLike,
  order: OrderLike,
  intent: ReturnIntentRecord
): Promise<void> {
  const orderModule = scope.resolve(Modules.ORDER)
  const metadata = buildUpdatedMetadata(order, intent)
  await orderModule.updateOrders(order.id, { metadata })
  order.metadata = metadata
}

export async function getOrder(scope: ScopeLike, orderId: string): Promise<OrderLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "total",
      "metadata",
      "items.id",
      "items.title",
      "items.quantity",
      "items.variant.id",
      "items.variant.sku",
      "items.variant.title",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.data",
      "payment_collections.payments.refunds.amount",
      "payment_collections.payments.refunds.note",
    ],
    filters: { id: orderId },
  })

  const order = first<OrderLike>(data)
  if (!order) {
    throw new ReturnWorkflowError(
      "ORDER_NOT_FOUND",
      `Order ${orderId} was not found.`
    )
  }

  return order
}

async function getVariant(scope: ScopeLike, variantId: string): Promise<VariantLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "sku",
      "inventory_items.inventory_item_id",
      "inventory_items.required_quantity",
    ],
    filters: { id: variantId },
  })

  const variant = first<VariantLike>(data)
  if (!variant) {
    throw new ReturnWorkflowError(
      "VARIANT_NOT_FOUND",
      `Variant ${variantId} was not found.`
    )
  }

  return variant
}

async function getVariantsById(
  scope: ScopeLike,
  variantIds: string[]
): Promise<Record<string, VariantLike>> {
  const map: Record<string, VariantLike> = {}

  for (const variantId of variantIds) {
    if (map[variantId]) {
      continue
    }

    map[variantId] = await getVariant(scope, variantId)
  }

  return map
}

function resolveOrderItemBySelector(
  order: OrderLike,
  selector: ReturnItemInput
): {
  id: string
  title: string
  quantity: number
  variant_id: string
  sku: string
} {
  const items = Array.isArray(order.items) ? order.items : []
  const normalizedLineItemId = (selector.line_item_id ?? "").trim()
  const normalizedVariantId = (selector.variant_id ?? "").trim()
  const normalizedSku = (selector.sku ?? "").trim()

  const matched = items.find((item) => {
    if (normalizedLineItemId && item.id === normalizedLineItemId) {
      return true
    }

    if (normalizedVariantId && item.variant?.id === normalizedVariantId) {
      return true
    }

    if (normalizedSku && item.variant?.sku === normalizedSku) {
      return true
    }

    return false
  })

  if (!matched) {
    throw new ReturnWorkflowError(
      "RETURN_ITEM_NOT_FOUND",
      "Unable to resolve return item from selector."
    )
  }

  const lineItemId = (matched.id ?? "").trim()
  const variantId = (matched.variant?.id ?? "").trim()
  if (!lineItemId || !variantId) {
    throw new ReturnWorkflowError(
      "RETURN_ITEM_INVALID",
      "Return item must include line item id and variant id."
    )
  }

  const quantity = toPositiveInt(matched.quantity)
  if (quantity <= 0) {
    throw new ReturnWorkflowError(
      "RETURN_ITEM_INVALID",
      `Line item ${lineItemId} has invalid quantity.`
    )
  }

  const sku = (matched.variant?.sku ?? variantId).trim()
  const name = (matched.title ?? matched.variant?.title ?? sku).trim() || sku

  return {
    id: lineItemId,
    title: name,
    quantity,
    variant_id: variantId,
    sku,
  }
}

export async function resolveReturnItems(
  scope: ScopeLike,
  order: OrderLike,
  inputItems?: ReturnItemInput[]
): Promise<ReturnItemRecord[]> {
  const selectedInputs =
    inputItems && inputItems.length
      ? inputItems
      : (Array.isArray(order.items) ? order.items : []).map((item) => ({
          line_item_id: item.id ?? undefined,
          quantity: toPositiveInt(item.quantity),
        }))

  if (!selectedInputs.length) {
    throw new ReturnWorkflowError(
      "RETURN_ITEMS_REQUIRED",
      "At least one return item is required."
    )
  }

  const selectedItems = selectedInputs.map((input) => {
    const orderItem = resolveOrderItemBySelector(order, input)
    const requestedQty = toPositiveInt(input.quantity)

    if (requestedQty <= 0) {
      throw new ReturnWorkflowError(
        "RETURN_ITEM_INVALID",
        "Return item quantity must be a positive integer."
      )
    }

    if (requestedQty > orderItem.quantity) {
      throw new ReturnWorkflowError(
        "RETURN_ITEM_INVALID",
        `Requested return quantity exceeds ordered quantity for ${orderItem.sku}.`
      )
    }

    return {
      ...orderItem,
      requested_quantity: requestedQty,
    }
  })

  const variantMap = await getVariantsById(
    scope,
    selectedItems.map((item) => item.variant_id)
  )

  return selectedItems.map((item) => {
    const variant = variantMap[item.variant_id]
    const inventoryItems = Array.isArray(variant.inventory_items)
      ? variant.inventory_items
      : []

    return {
      line_item_id: item.id,
      variant_id: item.variant_id,
      sku: item.sku,
      name: item.title,
      quantity: item.requested_quantity,
      inventory_items: inventoryItems
        .filter((inventoryItem) => Boolean(inventoryItem.inventory_item_id))
        .map((inventoryItem) => ({
          inventory_item_id: inventoryItem.inventory_item_id as string,
          required_quantity: Math.max(
            1,
            toPositiveInt(inventoryItem.required_quantity ?? 1)
          ),
        })),
    }
  })
}

function assertIdempotencyKeyAvailability(
  intent: ReturnIntentRecord,
  action: ReturnAction,
  idempotencyKey: string
): "fresh" | "replay" {
  const existing = intent.idempotency_log?.[idempotencyKey]
  if (!existing) {
    return "fresh"
  }

  if (existing.action === action) {
    return "replay"
  }

  throw new ReturnWorkflowError(
    "IDEMPOTENCY_KEY_CONFLICT",
    `Idempotency key ${idempotencyKey} was already used for ${existing.action}.`
  )
}

function assertAllowedTransition(from: ReturnState, to: ReturnState): void {
  if (from === to) {
    return
  }

  if (ALLOWED_NEXT_STATE[from].includes(to)) {
    return
  }

  throw new ReturnWorkflowError(
    "INVALID_RETURN_STATE_TRANSITION",
    `Cannot move return from ${from} to ${to}.`
  )
}

export function applyReturnTransition(
  intent: ReturnIntentRecord,
  input: {
    action: ReturnAction
    to_state: ReturnState
    idempotency_key: string
    actor_id?: string
    reason?: string
  }
): {
  changed: boolean
  from_state: ReturnState
  to_state: ReturnState
  intent: ReturnIntentRecord
} {
  const idempotencyMode = assertIdempotencyKeyAvailability(
    intent,
    input.action,
    input.idempotency_key
  )

  if (idempotencyMode === "replay") {
    return {
      changed: false,
      from_state: intent.state,
      to_state: intent.state,
      intent,
    }
  }

  if (intent.state === input.to_state) {
    return {
      changed: false,
      from_state: intent.state,
      to_state: intent.state,
      intent: {
        ...intent,
        idempotency_log: {
          ...intent.idempotency_log,
          [input.idempotency_key]: {
            action: input.action,
            at: new Date().toISOString(),
            actor_id: input.actor_id,
          },
        },
      },
    }
  }

  assertAllowedTransition(intent.state, input.to_state)

  const now = new Date().toISOString()
  return {
    changed: true,
    from_state: intent.state,
    to_state: input.to_state,
    intent: {
      ...intent,
      state: input.to_state,
      updated_at: now,
      idempotency_log: {
        ...intent.idempotency_log,
        [input.idempotency_key]: {
          action: input.action,
          at: now,
          actor_id: input.actor_id,
        },
      },
      status_history: [
        ...(intent.status_history ?? []),
        {
          action: input.action,
          from_status: intent.state,
          to_status: input.to_state,
          at: now,
          actor_id: input.actor_id,
          reason: input.reason?.trim() || undefined,
        },
      ],
    },
  }
}

export function createReturnIntent(input: {
  order_id: string
  return_id: string
  reason_code: ReturnReasonCode
  note?: string
  items: ReturnItemRecord[]
  idempotency_key: string
  actor_id?: string
  refund?: ReturnIntentRecord["refund"]
}): ReturnIntentRecord {
  const now = new Date().toISOString()
  return {
    return_id: input.return_id,
    order_id: input.order_id,
    state: "requested",
    reason_code: input.reason_code,
    note: input.note?.trim() || undefined,
    items: input.items,
    created_at: now,
    updated_at: now,
    idempotency_log: {
      [input.idempotency_key]: {
        action: "return_request",
        at: now,
        actor_id: input.actor_id,
      },
    },
    status_history: [
      {
        action: "return_request",
        from_status: null,
        to_status: "requested",
        at: now,
        actor_id: input.actor_id,
      },
    ],
    refund: input.refund,
  }
}

function appendInventoryMovement(
  intent: ReturnIntentRecord,
  movement: ReturnInventoryMovement
): ReturnIntentRecord {
  return {
    ...intent,
    inventory_movements: [...(intent.inventory_movements ?? []), movement],
    updated_at: movement.at,
  }
}

function resolveLocationIdByName(
  locations: StockLocationLike[],
  bucketCode: string
): string | undefined {
  const wanted = normalizeBucketName(bucketCode)
  return locations.find((location) => normalizeBucketName(location.name) === wanted)
    ?.id
}

async function resolveBucketLocationIds(scope: ScopeLike): Promise<{
  sellable_location_id: string
  qc_hold_location_id: string
  damage_location_id: string
}> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
    filters: {},
  })

  const locations = Array.isArray(data) ? (data as StockLocationLike[]) : []
  const sellableLocationId = resolveLocationIdByName(
    locations,
    getSellableBucketCode()
  )
  const qcHoldLocationId = resolveLocationIdByName(locations, getQcHoldBucketCode())
  const damageLocationId = resolveLocationIdByName(locations, getDamageBucketCode())

  const missing: string[] = []
  if (!sellableLocationId) {
    missing.push(getSellableBucketCode())
  }
  if (!qcHoldLocationId) {
    missing.push(getQcHoldBucketCode())
  }
  if (!damageLocationId) {
    missing.push(getDamageBucketCode())
  }

  if (missing.length) {
    throw new ReturnWorkflowError(
      "INVENTORY_BUCKET_NOT_FOUND",
      `Missing stock location(s): ${missing.join(", ")}.`
    )
  }

  return {
    sellable_location_id: sellableLocationId as string,
    qc_hold_location_id: qcHoldLocationId as string,
    damage_location_id: damageLocationId as string,
  }
}

export async function applyInventoryMovementForReturn(
  scope: ScopeLike,
  intent: ReturnIntentRecord,
  mode: ReturnInventoryMovement["mode"]
): Promise<{
  intent: ReturnIntentRecord
  movement: ReturnInventoryMovement
}> {
  const inventoryModule = scope.resolve(Modules.INVENTORY)
  const locationIds = await resolveBucketLocationIds(scope)
  const adjustmentMap = new Map<string, { inventoryItemId: string; locationId: string; adjustment: number }>()

  const registerAdjustment = (
    inventoryItemId: string,
    locationId: string,
    adjustment: number
  ) => {
    if (!adjustment) {
      return
    }

    const key = `${inventoryItemId}:${locationId}`
    const existing = adjustmentMap.get(key)
    if (existing) {
      existing.adjustment += adjustment
      adjustmentMap.set(key, existing)
      return
    }

    adjustmentMap.set(key, {
      inventoryItemId,
      locationId,
      adjustment,
    })
  }

  for (const item of intent.items) {
    for (const inventoryItem of item.inventory_items) {
      const units = Math.max(1, item.quantity) * Math.max(1, inventoryItem.required_quantity)

      if (mode === "to_qc_hold") {
        registerAdjustment(
          inventoryItem.inventory_item_id,
          locationIds.qc_hold_location_id,
          units
        )
      }

      if (mode === "qc_hold_to_sellable") {
        registerAdjustment(
          inventoryItem.inventory_item_id,
          locationIds.qc_hold_location_id,
          -units
        )
        registerAdjustment(
          inventoryItem.inventory_item_id,
          locationIds.sellable_location_id,
          units
        )
      }

      if (mode === "qc_hold_to_damage") {
        registerAdjustment(
          inventoryItem.inventory_item_id,
          locationIds.qc_hold_location_id,
          -units
        )
        registerAdjustment(
          inventoryItem.inventory_item_id,
          locationIds.damage_location_id,
          units
        )
      }
    }
  }

  const payload = Array.from(adjustmentMap.values()).filter(
    (entry) => entry.adjustment !== 0
  )

  if (payload.length) {
    await inventoryModule.adjustInventory(payload)
  }

  const now = new Date().toISOString()
  const movement: ReturnInventoryMovement = {
    mode,
    at: now,
    adjustments: payload.map((entry) => ({
      inventory_item_id: entry.inventoryItemId,
      location_id: entry.locationId,
      adjustment: entry.adjustment,
    })),
  }

  return {
    intent: appendInventoryMovement(intent, movement),
    movement,
  }
}

export function isCodOrder(order: OrderLike): boolean {
  const paymentCollections = Array.isArray(order.payment_collections)
    ? order.payment_collections
    : []

  for (const paymentCollection of paymentCollections) {
    for (const payment of paymentCollection.payments ?? []) {
      if (payment.provider_id === "pp_cod_cod") {
        return true
      }
    }
  }

  return false
}

export function resolveRefundAmount(
  order: OrderLike,
  intent: ReturnIntentRecord,
  explicitAmount?: number
): number {
  const inputAmount = toNumber(explicitAmount)
  if (inputAmount > 0) {
    return Math.round(inputAmount * 100) / 100
  }

  const storedAmount = toNumber(intent.refund?.amount)
  if (storedAmount > 0) {
    return Math.round(storedAmount * 100) / 100
  }

  return Math.round(toNumber(order.total) * 100) / 100
}

export function withRefund(
  intent: ReturnIntentRecord,
  refund: ReturnIntentRecord["refund"]
): ReturnIntentRecord {
  return {
    ...intent,
    refund,
    updated_at: refund?.updated_at || intent.updated_at,
  }
}

export function markAsRefunded(
  intent: ReturnIntentRecord,
  actorId?: string
): ReturnIntentRecord {
  if (intent.state === "refunded") {
    return intent
  }

  const now = new Date().toISOString()
  return {
    ...intent,
    state: "refunded",
    updated_at: now,
    status_history: [
      ...(intent.status_history ?? []),
      {
        action: "return_qc_pass",
        from_status: intent.state,
        to_status: "refunded",
        at: now,
        actor_id: actorId,
      },
    ],
  }
}

export async function emitReturnEvent(
  scope: ScopeLike,
  name: string,
  data: Record<string, unknown>
): Promise<void> {
  await emitBusinessEvent(scope as any, {
    name,
    data,
    workflow_name: "return_workflow",
    step_name: "emit_event",
    order_id: typeof data.order_id === "string" ? data.order_id : undefined,
    return_id: typeof data.return_id === "string" ? data.return_id : undefined,
  })
}
