import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  resolveReturnItems,
  type ReturnItemInput,
  type ReturnItemRecord,
  toNumber,
} from "../returns/shared"
import { emitBusinessEvent } from "../../modules/logging/business-events"

export type ScopeLike = {
  resolve: (key: string) => any
}

export type RtoState =
  | "initiated"
  | "received"
  | "qc_passed"
  | "qc_failed"
  | "closed"

export type RtoAction =
  | "rto_initiate"
  | "rto_receive"
  | "rto_qc_pass"
  | "rto_qc_fail"
  | "rto_close"

type RtoIdempotencyEntry = {
  action: RtoAction
  at: string
  actor_id?: string
}

type RtoHistoryEntry = {
  action: RtoAction
  from_status: RtoState | null
  to_status: RtoState
  at: string
  actor_id?: string
  reason?: string
}

export type RtoInventoryMovement = {
  mode: "to_qc_hold" | "qc_hold_to_sellable" | "qc_hold_to_damage"
  at: string
  adjustments: Array<{
    inventory_item_id: string
    location_id: string
    adjustment: number
  }>
}

export type RtoIntentRecord = {
  rto_id: string
  order_id: string
  state: RtoState
  note?: string
  items: ReturnItemRecord[]
  created_at: string
  updated_at: string
  idempotency_log: Record<string, RtoIdempotencyEntry>
  status_history: RtoHistoryEntry[]
  inventory_movements?: RtoInventoryMovement[]
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
  payment_collections?: Array<{
    payments?: Array<{
      id?: string | null
      provider_id?: string | null
      amount?: number | string | null
      captured_at?: string | null
      data?: Record<string, unknown> | null
    }> | null
  }> | null
}

type StockLocationLike = {
  id: string
  name?: string | null
}

const COD_PROVIDER_ID = "pp_cod_cod"
const WAREHOUSE_NAME = "WH-MRT-01"

const ALLOWED_NEXT_STATE: Record<RtoState, RtoState[]> = {
  initiated: ["received"],
  received: ["qc_passed", "qc_failed"],
  qc_passed: ["closed"],
  qc_failed: ["closed"],
  closed: [],
}

export class RtoWorkflowError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "RtoWorkflowError"
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

function getDamageBucketCode(): string {
  return process.env.SVB_DAMAGE_LOCATION_CODE?.trim() || "DAMAGE"
}

function getRtoIntents(
  metadata: Record<string, unknown> | null | undefined
): Record<string, RtoIntentRecord> {
  const value = metadata?.rto_intents_v1
  if (!value || typeof value !== "object") {
    return {}
  }

  return value as Record<string, RtoIntentRecord>
}

function buildUpdatedMetadata(
  order: OrderLike,
  intent: RtoIntentRecord
): Record<string, unknown> {
  const currentMetadata =
    order.metadata && typeof order.metadata === "object" ? order.metadata : {}
  const intents = getRtoIntents(currentMetadata)

  return {
    ...currentMetadata,
    rto_state_v1: intent.state,
    rto_intents_v1: {
      ...intents,
      [intent.rto_id]: intent,
    },
  }
}

export function normalizeRtoId(value?: string): string {
  const normalized = (value ?? "").trim()
  return normalized || "rto_1"
}

export function requireIdempotencyKey(value?: string): string {
  const normalized = (value ?? "").trim()
  if (!normalized) {
    throw new RtoWorkflowError(
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
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.data",
    ],
    filters: { id: orderId },
  })

  const order = first<OrderLike>(data)
  if (!order) {
    throw new RtoWorkflowError("ORDER_NOT_FOUND", `Order ${orderId} was not found.`)
  }

  return order
}

export function getRtoIntent(
  order: { metadata?: Record<string, unknown> | null },
  rtoId: string
): RtoIntentRecord | undefined {
  return getRtoIntents(order.metadata)[rtoId]
}

export function getRtoIntentOrThrow(order: OrderLike, rtoId: string): RtoIntentRecord {
  const intent = getRtoIntent(order, rtoId)
  if (!intent) {
    throw new RtoWorkflowError(
      "RTO_NOT_FOUND",
      `RTO ${rtoId} was not found for order ${order.id}.`
    )
  }

  return intent
}

export async function persistRtoIntent(
  scope: ScopeLike,
  order: OrderLike,
  intent: RtoIntentRecord
): Promise<void> {
  const orderModule = scope.resolve(Modules.ORDER)
  const metadata = buildUpdatedMetadata(order, intent)
  await orderModule.updateOrders(order.id, { metadata })
  order.metadata = metadata
}

function assertIdempotencyKeyAvailability(
  intent: RtoIntentRecord,
  action: RtoAction,
  idempotencyKey: string
): "fresh" | "replay" {
  const existing = intent.idempotency_log?.[idempotencyKey]
  if (!existing) {
    return "fresh"
  }

  if (existing.action === action) {
    return "replay"
  }

  throw new RtoWorkflowError(
    "IDEMPOTENCY_KEY_CONFLICT",
    `Idempotency key ${idempotencyKey} was already used for ${existing.action}.`
  )
}

function assertAllowedTransition(from: RtoState, to: RtoState): void {
  if (from === to) {
    return
  }

  if (ALLOWED_NEXT_STATE[from].includes(to)) {
    return
  }

  throw new RtoWorkflowError(
    "INVALID_RTO_STATE_TRANSITION",
    `Cannot move RTO from ${from} to ${to}.`
  )
}

export function applyRtoTransition(
  intent: RtoIntentRecord,
  input: {
    action: RtoAction
    to_state: RtoState
    idempotency_key: string
    actor_id?: string
    reason?: string
  }
): {
  changed: boolean
  from_state: RtoState
  to_state: RtoState
  intent: RtoIntentRecord
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

export async function resolveRtoItems(
  scope: ScopeLike,
  order: OrderLike,
  inputItems?: ReturnItemInput[]
): Promise<ReturnItemRecord[]> {
  return resolveReturnItems(scope as any, order as any, inputItems)
}

export function createRtoIntent(input: {
  order_id: string
  rto_id: string
  note?: string
  items: ReturnItemRecord[]
  idempotency_key: string
  actor_id?: string
}): RtoIntentRecord {
  const now = new Date().toISOString()
  return {
    rto_id: input.rto_id,
    order_id: input.order_id,
    state: "initiated",
    note: input.note?.trim() || undefined,
    items: input.items,
    created_at: now,
    updated_at: now,
    idempotency_log: {
      [input.idempotency_key]: {
        action: "rto_initiate",
        at: now,
        actor_id: input.actor_id,
      },
    },
    status_history: [
      {
        action: "rto_initiate",
        from_status: null,
        to_status: "initiated",
        at: now,
        actor_id: input.actor_id,
      },
    ],
  }
}

function appendInventoryMovement(
  intent: RtoIntentRecord,
  movement: RtoInventoryMovement
): RtoIntentRecord {
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
    throw new RtoWorkflowError(
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

export async function applyInventoryMovementForRto(
  scope: ScopeLike,
  intent: RtoIntentRecord,
  mode: RtoInventoryMovement["mode"]
): Promise<{
  intent: RtoIntentRecord
  movement: RtoInventoryMovement
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
  const movement: RtoInventoryMovement = {
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

function getPayments(order: OrderLike): Array<{
  id?: string | null
  provider_id?: string | null
  amount?: number | string | null
  captured_at?: string | null
  data?: Record<string, unknown> | null
}> {
  const payments: Array<{
    id?: string | null
    provider_id?: string | null
    amount?: number | string | null
    captured_at?: string | null
    data?: Record<string, unknown> | null
  }> = []

  for (const collection of order.payment_collections ?? []) {
    for (const payment of collection.payments ?? []) {
      payments.push(payment)
    }
  }

  return payments
}

function isCodCaptured(payment: {
  captured_at?: string | null
  data?: Record<string, unknown> | null
}): boolean {
  if (payment.captured_at) {
    return true
  }

  const state = payment.data?.cod_state
  return state === "captured" || state === "refunded"
}

export function assertCodNotCapturedForRto(order: OrderLike): void {
  const codPayment = getPayments(order).find(
    (payment) => payment.provider_id === COD_PROVIDER_ID
  )

  if (!codPayment) {
    return
  }

  if (isCodCaptured(codPayment)) {
    throw new RtoWorkflowError(
      "COD_CAPTURE_NOT_ALLOWED_FOR_RTO",
      `COD payment for order ${order.id} is already captured; RTO requires uncaptured COD.`
    )
  }
}

export function isPrepaidOrder(order: OrderLike): boolean {
  return getPayments(order).some(
    (payment) => payment.provider_id && payment.provider_id !== COD_PROVIDER_ID
  )
}

export async function emitPrepaidRefundStubForRto(
  scope: ScopeLike,
  input: {
    order_id: string
    rto_id: string
    stage: "qc_passed" | "qc_failed"
  }
): Promise<void> {
  await emitBusinessEvent(scope as any, {
    name: "rto.prepaid_refund_pending",
    workflow_name: "rto_workflow",
    step_name: "emit_event",
    order_id: input.order_id,
    data: {
      order_id: input.order_id,
      rto_id: input.rto_id,
      stage: input.stage,
    },
  })
}

export async function emitRtoEvent(
  scope: ScopeLike,
  name: string,
  data: Record<string, unknown>
): Promise<void> {
  await emitBusinessEvent(scope as any, {
    name,
    data,
    workflow_name: "rto_workflow",
    step_name: "emit_event",
    order_id: typeof data.order_id === "string" ? data.order_id : undefined,
  })
}

export type { ReturnItemInput }
