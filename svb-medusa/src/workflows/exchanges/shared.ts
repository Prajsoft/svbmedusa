import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { OutOfStockError, WAREHOUSE_NAME } from "../../modules/inventory/check-availability"
import { emitBusinessEvent } from "../../modules/logging/business-events"
import {
  assertReturnReasonCode,
  resolveReturnItems,
  type ReturnItemInput,
  type ReturnItemRecord,
  type ReturnReasonCode,
  toNumber,
} from "../returns/shared"

export type ScopeLike = {
  resolve: (key: string) => any
}

export type ExchangeState =
  | "requested"
  | "approved"
  | "return_received"
  | "replacement_reserved"
  | "replacement_shipped"
  | "delivered"
  | "closed"

export type ExchangeAction =
  | "exchange_request"
  | "exchange_approve"
  | "exchange_receive_return"
  | "exchange_reserve_replacement"
  | "exchange_ship_replacement"
  | "exchange_close"

export type ExchangeReplacementItemInput = {
  variant_id?: string
  sku?: string
  quantity: number
  name?: string
}

export type ExchangeReplacementItemRecord = {
  variant_id: string
  sku: string
  name: string
  quantity: number
  inventory_items: Array<{
    inventory_item_id: string
    required_quantity: number
  }>
}

export type ExchangeInventoryMovement = {
  mode: "return_to_qc_hold" | "reserve_replacement" | "ship_replacement"
  at: string
  adjustments: Array<{
    inventory_item_id: string
    location_id: string
    adjustment: number
  }>
}

type ExchangeIdempotencyEntry = {
  action: ExchangeAction
  at: string
  actor_id?: string
}

type ExchangeHistoryEntry = {
  action: ExchangeAction
  from_status: ExchangeState | null
  to_status: ExchangeState
  at: string
  actor_id?: string
  reason?: string
}

export type ExchangeIntentRecord = {
  exchange_id: string
  order_id: string
  state: ExchangeState
  reason_code: ReturnReasonCode
  note?: string
  reservation_policy: "after_return_received"
  return_items: ReturnItemRecord[]
  replacement_items: ExchangeReplacementItemRecord[]
  created_at: string
  updated_at: string
  idempotency_log: Record<string, ExchangeIdempotencyEntry>
  status_history: ExchangeHistoryEntry[]
  inventory_movements?: ExchangeInventoryMovement[]
}

type OrderLike = {
  id: string
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
}

type VariantLike = {
  id: string
  sku?: string | null
  title?: string | null
  inventory_items?: Array<{
    inventory_item_id?: string | null
    required_quantity?: number | string | null
  }> | null
}

type StockLocationLike = {
  id: string
  name?: string | null
}

const ALLOWED_NEXT_STATE: Record<ExchangeState, ExchangeState[]> = {
  requested: ["approved"],
  approved: ["return_received"],
  return_received: ["replacement_reserved"],
  replacement_reserved: ["replacement_shipped"],
  replacement_shipped: ["delivered", "closed"],
  delivered: ["closed"],
  closed: [],
}

export class ExchangeWorkflowError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "ExchangeWorkflowError"
    this.code = code
  }
}

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

function toPositiveInt(value: unknown): number {
  const parsed = Math.floor(toNumber(value))
  return parsed > 0 ? parsed : 0
}

function normalizeBucketName(value: unknown): string {
  return String(value ?? "").trim().toUpperCase()
}

function getSellableBucketCode(): string {
  return process.env.SVB_SELLABLE_LOCATION_CODE?.trim() || WAREHOUSE_NAME
}

function getQcHoldBucketCode(): string {
  return process.env.SVB_QC_HOLD_LOCATION_CODE?.trim() || "QC_HOLD"
}

function getExchangeHoldBucketCode(): string {
  return process.env.SVB_EXCHANGE_HOLD_LOCATION_CODE?.trim() || "EXCHANGE_HOLD"
}

function getExchangeIntents(
  metadata: Record<string, unknown> | null | undefined
): Record<string, ExchangeIntentRecord> {
  const value = metadata?.exchange_intents_v1
  if (!value || typeof value !== "object") {
    return {}
  }

  return value as Record<string, ExchangeIntentRecord>
}

function buildUpdatedMetadata(
  order: OrderLike,
  intent: ExchangeIntentRecord
): Record<string, unknown> {
  const currentMetadata =
    order.metadata && typeof order.metadata === "object" ? order.metadata : {}
  const intents = getExchangeIntents(currentMetadata)

  return {
    ...currentMetadata,
    exchange_state_v1: intent.state,
    exchange_intents_v1: {
      ...intents,
      [intent.exchange_id]: intent,
    },
  }
}

export function normalizeExchangeId(value?: string): string {
  const normalized = (value ?? "").trim()
  return normalized || "exchange_1"
}

export function requireIdempotencyKey(value?: string): string {
  const normalized = (value ?? "").trim()
  if (!normalized) {
    throw new ExchangeWorkflowError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "idempotency_key is required."
    )
  }

  return normalized
}

export async function getOrder(scope: ScopeLike, orderId: string): Promise<OrderLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "metadata",
      "items.id",
      "items.title",
      "items.quantity",
      "items.variant.id",
      "items.variant.sku",
      "items.variant.title",
    ],
    filters: { id: orderId },
  })

  const order = first<OrderLike>(data)
  if (!order) {
    throw new ExchangeWorkflowError(
      "ORDER_NOT_FOUND",
      `Order ${orderId} was not found.`
    )
  }

  return order
}

export function getExchangeIntent(
  order: { metadata?: Record<string, unknown> | null },
  exchangeId: string
): ExchangeIntentRecord | undefined {
  return getExchangeIntents(order.metadata)[exchangeId]
}

export function getExchangeIntentOrThrow(
  order: OrderLike,
  exchangeId: string
): ExchangeIntentRecord {
  const intent = getExchangeIntent(order, exchangeId)
  if (!intent) {
    throw new ExchangeWorkflowError(
      "EXCHANGE_NOT_FOUND",
      `Exchange ${exchangeId} was not found for order ${order.id}.`
    )
  }

  return intent
}

export async function persistExchangeIntent(
  scope: ScopeLike,
  order: OrderLike,
  intent: ExchangeIntentRecord
): Promise<void> {
  const orderModule = scope.resolve(Modules.ORDER)
  const metadata = buildUpdatedMetadata(order, intent)
  await orderModule.updateOrders(order.id, { metadata })
  order.metadata = metadata
}

function assertIdempotencyKeyAvailability(
  intent: ExchangeIntentRecord,
  action: ExchangeAction,
  idempotencyKey: string
): "fresh" | "replay" {
  const existing = intent.idempotency_log?.[idempotencyKey]
  if (!existing) {
    return "fresh"
  }

  if (existing.action === action) {
    return "replay"
  }

  throw new ExchangeWorkflowError(
    "IDEMPOTENCY_KEY_CONFLICT",
    `Idempotency key ${idempotencyKey} was already used for ${existing.action}.`
  )
}

function assertAllowedTransition(from: ExchangeState, to: ExchangeState): void {
  if (from === to) {
    return
  }

  if (ALLOWED_NEXT_STATE[from].includes(to)) {
    return
  }

  throw new ExchangeWorkflowError(
    "INVALID_EXCHANGE_STATE_TRANSITION",
    `Cannot move exchange from ${from} to ${to}.`
  )
}

export function applyExchangeTransition(
  intent: ExchangeIntentRecord,
  input: {
    action: ExchangeAction
    to_state: ExchangeState
    idempotency_key: string
    actor_id?: string
    reason?: string
  }
): {
  changed: boolean
  from_state: ExchangeState
  to_state: ExchangeState
  intent: ExchangeIntentRecord
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

export async function resolveExchangeReturnItems(
  scope: ScopeLike,
  order: OrderLike,
  inputItems?: ReturnItemInput[]
): Promise<ReturnItemRecord[]> {
  return resolveReturnItems(scope as any, order as any, inputItems)
}

async function getVariantBySelector(
  scope: ScopeLike,
  selector: { variant_id?: string; sku?: string }
): Promise<VariantLike> {
  const variantId = (selector.variant_id ?? "").trim()
  const sku = (selector.sku ?? "").trim()

  if (!variantId && !sku) {
    throw new ExchangeWorkflowError(
      "REPLACEMENT_VARIANT_REQUIRED",
      "Replacement item requires variant_id or sku."
    )
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "sku",
      "title",
      "inventory_items.inventory_item_id",
      "inventory_items.required_quantity",
    ],
    filters: variantId ? { id: variantId } : { sku },
  })

  const variant = first<VariantLike>(data)
  if (!variant) {
    throw new ExchangeWorkflowError(
      "VARIANT_NOT_FOUND",
      `Replacement variant was not found for selector ${variantId || sku}.`
    )
  }

  return variant
}

export async function resolveReplacementItems(
  scope: ScopeLike,
  order: OrderLike,
  returnItems: ReturnItemRecord[],
  inputItems?: ExchangeReplacementItemInput[]
): Promise<ExchangeReplacementItemRecord[]> {
  const selectedInputs =
    inputItems && inputItems.length
      ? inputItems
      : returnItems.map((item) => ({
          variant_id: item.variant_id,
          quantity: item.quantity,
          name: item.name,
        }))

  if (!selectedInputs.length) {
    throw new ExchangeWorkflowError(
      "REPLACEMENT_ITEMS_REQUIRED",
      "At least one replacement item is required."
    )
  }

  const replacements: ExchangeReplacementItemRecord[] = []

  for (const item of selectedInputs) {
    const requestedQty = toPositiveInt(item.quantity)
    if (requestedQty <= 0) {
      throw new ExchangeWorkflowError(
        "REPLACEMENT_ITEM_INVALID",
        "Replacement quantity must be a positive integer."
      )
    }

    const variant = await getVariantBySelector(scope, item)
    const variantId = variant.id
    const variantSku = (variant.sku ?? variant.id).trim()
    const name = (item.name ?? variant.title ?? variantSku).trim() || variantSku
    const inventoryItems = Array.isArray(variant.inventory_items)
      ? variant.inventory_items
      : []

    replacements.push({
      variant_id: variantId,
      sku: variantSku,
      name,
      quantity: requestedQty,
      inventory_items: inventoryItems
        .filter((inventoryItem) => Boolean(inventoryItem.inventory_item_id))
        .map((inventoryItem) => ({
          inventory_item_id: inventoryItem.inventory_item_id as string,
          required_quantity: Math.max(
            1,
            toPositiveInt(inventoryItem.required_quantity ?? 1)
          ),
        })),
    })
  }

  return replacements
}

export function createExchangeIntent(input: {
  order_id: string
  exchange_id: string
  reason_code: ReturnReasonCode
  note?: string
  return_items: ReturnItemRecord[]
  replacement_items: ExchangeReplacementItemRecord[]
  idempotency_key: string
  actor_id?: string
}): ExchangeIntentRecord {
  const now = new Date().toISOString()
  return {
    exchange_id: input.exchange_id,
    order_id: input.order_id,
    state: "requested",
    reason_code: input.reason_code,
    note: input.note?.trim() || undefined,
    reservation_policy: "after_return_received",
    return_items: input.return_items,
    replacement_items: input.replacement_items,
    created_at: now,
    updated_at: now,
    idempotency_log: {
      [input.idempotency_key]: {
        action: "exchange_request",
        at: now,
        actor_id: input.actor_id,
      },
    },
    status_history: [
      {
        action: "exchange_request",
        from_status: null,
        to_status: "requested",
        at: now,
        actor_id: input.actor_id,
      },
    ],
  }
}

function appendInventoryMovement(
  intent: ExchangeIntentRecord,
  movement: ExchangeInventoryMovement
): ExchangeIntentRecord {
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
  exchange_hold_location_id: string
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
  const exchangeHoldLocationId = resolveLocationIdByName(
    locations,
    getExchangeHoldBucketCode()
  )

  const missing: string[] = []
  if (!sellableLocationId) {
    missing.push(getSellableBucketCode())
  }
  if (!qcHoldLocationId) {
    missing.push(getQcHoldBucketCode())
  }
  if (!exchangeHoldLocationId) {
    missing.push(getExchangeHoldBucketCode())
  }

  if (missing.length) {
    throw new ExchangeWorkflowError(
      "INVENTORY_BUCKET_NOT_FOUND",
      `Missing stock location(s): ${missing.join(", ")}.`
    )
  }

  return {
    sellable_location_id: sellableLocationId as string,
    qc_hold_location_id: qcHoldLocationId as string,
    exchange_hold_location_id: exchangeHoldLocationId as string,
  }
}

export async function assertReplacementAvailability(
  scope: ScopeLike,
  intent: ExchangeIntentRecord
): Promise<void> {
  const inventoryModule = scope.resolve(Modules.INVENTORY)
  const locations = await resolveBucketLocationIds(scope)

  for (const replacement of intent.replacement_items) {
    if (!replacement.inventory_items.length) {
      throw new OutOfStockError(replacement.sku)
    }

    let maxUnits = Number.POSITIVE_INFINITY
    for (const inventoryItem of replacement.inventory_items) {
      const availableRaw = await inventoryModule.retrieveAvailableQuantity(
        inventoryItem.inventory_item_id,
        [locations.sellable_location_id]
      )
      const availableQty = toNumber(availableRaw)
      const maxFromItem = Math.floor(
        availableQty / Math.max(1, inventoryItem.required_quantity)
      )
      maxUnits = Math.min(maxUnits, maxFromItem)
    }

    const availableUnits = Number.isFinite(maxUnits) ? Math.max(0, maxUnits) : 0
    if (replacement.quantity > availableUnits) {
      throw new OutOfStockError(replacement.sku)
    }
  }
}

export async function applyInventoryMovementForExchange(
  scope: ScopeLike,
  intent: ExchangeIntentRecord,
  mode: ExchangeInventoryMovement["mode"]
): Promise<{
  intent: ExchangeIntentRecord
  movement: ExchangeInventoryMovement
}> {
  const inventoryModule = scope.resolve(Modules.INVENTORY)
  const locationIds = await resolveBucketLocationIds(scope)
  const adjustmentMap = new Map<
    string,
    { inventoryItemId: string; locationId: string; adjustment: number }
  >()

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

  if (mode === "return_to_qc_hold") {
    for (const item of intent.return_items) {
      for (const inventoryItem of item.inventory_items) {
        const units = Math.max(1, item.quantity) * Math.max(1, inventoryItem.required_quantity)
        registerAdjustment(
          inventoryItem.inventory_item_id,
          locationIds.qc_hold_location_id,
          units
        )
      }
    }
  }

  if (mode === "reserve_replacement") {
    for (const item of intent.replacement_items) {
      for (const inventoryItem of item.inventory_items) {
        const units = Math.max(1, item.quantity) * Math.max(1, inventoryItem.required_quantity)
        registerAdjustment(
          inventoryItem.inventory_item_id,
          locationIds.sellable_location_id,
          -units
        )
        registerAdjustment(
          inventoryItem.inventory_item_id,
          locationIds.exchange_hold_location_id,
          units
        )
      }
    }
  }

  if (mode === "ship_replacement") {
    for (const item of intent.replacement_items) {
      for (const inventoryItem of item.inventory_items) {
        const units = Math.max(1, item.quantity) * Math.max(1, inventoryItem.required_quantity)
        registerAdjustment(
          inventoryItem.inventory_item_id,
          locationIds.exchange_hold_location_id,
          -units
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
  const movement: ExchangeInventoryMovement = {
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

export async function emitExchangeEvent(
  scope: ScopeLike,
  name: string,
  data: Record<string, unknown>
): Promise<void> {
  await emitBusinessEvent(scope as any, {
    name,
    data,
    workflow_name: "exchange_workflow",
    step_name: "emit_event",
    order_id: typeof data.order_id === "string" ? data.order_id : undefined,
  })
}

export { assertReturnReasonCode, type ReturnItemInput, type ReturnReasonCode }
