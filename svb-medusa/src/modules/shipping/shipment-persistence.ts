import { randomUUID } from "crypto"
import { ShipmentStatus } from "../../integrations/carriers/provider-contract"
import { sanitizeProviderPayload } from "./sanitize-provider-payload"

export const SHIPPING_SHIPMENTS_TABLE = "shipping_shipments"
export const SHIPPING_EVENTS_TABLE = "shipping_events"
export const SHIPPING_WEBHOOK_BUFFER_TABLE = "shipping_webhook_buffer"
export const DEFAULT_SHIPPING_EVENTS_PAYLOAD_TTL_DAYS = 90
export const DEFAULT_SHIPPING_WEBHOOK_REPLAY_BATCH_SIZE = 100

export const ShipmentLabelStatus = {
  AVAILABLE: "AVAILABLE",
  EXPIRED: "EXPIRED",
  MISSING: "MISSING",
  REGEN_REQUIRED: "REGEN_REQUIRED",
} as const

export type ShipmentLabelStatus =
  (typeof ShipmentLabelStatus)[keyof typeof ShipmentLabelStatus]

type QueryResultLike = {
  rows?: Array<Record<string, unknown>>
}

type PgConnectionLike = {
  raw: (query: string, bindings?: unknown[]) => Promise<QueryResultLike>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readNullableText(value: unknown): string | null {
  const normalized = readText(value)
  return normalized ? normalized : null
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    return value !== 0
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["true", "1", "yes", "y"].includes(normalized)) {
      return true
    }
    if (["false", "0", "no", "n"].includes(normalized)) {
      return false
    }
  }

  return fallback
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function toNullableDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return null
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const floored = Math.floor(value)
    return floored > 0 ? floored : fallback
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      const floored = Math.floor(parsed)
      return floored > 0 ? floored : fallback
    }
  }

  return fallback
}

function nowDate(): Date {
  return new Date()
}

function mapShipmentRow(row: Record<string, unknown>): ShippingShipmentRecord {
  return {
    id: readText(row.id),
    order_id: readText(row.order_id),
    provider: readText(row.provider),
    internal_reference: readText(row.internal_reference),
    provider_order_id: readNullableText(row.provider_order_id),
    provider_shipment_id: readNullableText(row.provider_shipment_id),
    provider_awb: readNullableText(row.provider_awb),
    status: (readText(row.status) || ShipmentStatus.DRAFT) as ShippingShipmentRecord["status"],
    is_active: toBoolean(row.is_active, true),
    replacement_of_shipment_id: readNullableText(row.replacement_of_shipment_id),
    service_level: readNullableText(row.service_level),
    courier_code: readNullableText(row.courier_code),
    rate_amount: toNullableNumber(row.rate_amount),
    rate_currency: readNullableText(row.rate_currency),
    label_url: readNullableText(row.label_url),
    label_generated_at: toNullableDate(row.label_generated_at),
    label_expires_at: toNullableDate(row.label_expires_at),
    label_last_fetched_at: toNullableDate(row.label_last_fetched_at),
    label_status: (readText(row.label_status) ||
      ShipmentLabelStatus.MISSING) as ShipmentLabelStatus,
    created_at: toNullableDate(row.created_at) ?? nowDate(),
    updated_at: toNullableDate(row.updated_at) ?? nowDate(),
  }
}

function mapEventRow(row: Record<string, unknown>): ShippingEventRecord {
  return {
    id: readText(row.id),
    shipment_id: readText(row.shipment_id),
    provider: readText(row.provider),
    status: (readText(row.status) || ShipmentStatus.DRAFT) as ShippingEventRecord["status"],
    raw_status: readNullableText(row.raw_status),
    raw_payload_sanitized:
      row.raw_payload_sanitized && typeof row.raw_payload_sanitized === "object"
        ? (row.raw_payload_sanitized as Record<string, unknown>)
        : null,
    provider_event_id: readNullableText(row.provider_event_id),
    created_at: toNullableDate(row.created_at) ?? nowDate(),
    updated_at: toNullableDate(row.updated_at) ?? nowDate(),
  }
}

export class ShippingPersistenceError extends Error {
  code: string
  details: Record<string, unknown>

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = "ShippingPersistenceError"
    this.code = code
    this.details = details
  }
}

export type CreateShippingShipmentInput = {
  id?: string
  order_id: string
  provider: string
  internal_reference: string
  provider_order_id?: string | null
  provider_shipment_id?: string | null
  provider_awb?: string | null
  status?: ShipmentStatus
  is_active?: boolean
  replacement_of_shipment_id?: string | null
  service_level?: string | null
  courier_code?: string | null
  rate_amount?: number | null
  rate_currency?: string | null
  label_url?: string | null
  label_generated_at?: Date | string | null
  label_expires_at?: Date | string | null
  label_last_fetched_at?: Date | string | null
  label_status?: ShipmentLabelStatus
  replay_buffered_events?: boolean
}

export type RebookShipmentInput = {
  previous_shipment_id: string
  replacement: Omit<
    CreateShippingShipmentInput,
    "order_id" | "provider" | "replacement_of_shipment_id" | "is_active"
  >
}

export type CreateShippingEventInput = {
  id?: string
  shipment_id: string
  provider: string
  status: ShipmentStatus
  raw_status?: string | null
  raw_payload_sanitized?: Record<string, unknown> | null
  provider_event_id?: string | null
}

export type MarkShipmentBookedInput = {
  shipment_id: string
  provider_order_id?: string | null
  provider_shipment_id?: string | null
  provider_awb?: string | null
  status?: ShipmentStatus
  label_url?: string | null
  label_generated_at?: Date | string | null
  label_expires_at?: Date | string | null
  label_last_fetched_at?: Date | string | null
  label_status?: ShipmentLabelStatus
}

export type ListStuckBookingInProgressInput = {
  older_than?: Date
  limit?: number
}

export type ListActiveShipmentsByStatusesInput = {
  statuses: ShipmentStatus[]
  provider?: string
  limit?: number
}

export type PurgeShippingEventsPayloadInput = {
  ttl_days?: number
  now?: Date
}

export type BufferShippingWebhookInput = {
  id?: string
  provider: string
  provider_event_id: string
  provider_shipment_id?: string | null
  provider_awb?: string | null
  provider_order_id?: string | null
  internal_reference?: string | null
  event_type: string
  payload_sanitized?: Record<string, unknown> | null
}

export type ShippingWebhookBufferRecord = {
  id: string
  provider: string
  provider_event_id: string
  provider_shipment_id: string | null
  provider_awb: string | null
  event_type: string
  payload_sanitized: Record<string, unknown> | null
  received_at: Date
  processed_at: Date | null
  retry_count: number
}

export type ReplayBufferedEventsInput = {
  now?: Date
  limit?: number
}

export type ReplayBufferedEventsResult = {
  scanned: number
  processed: number
  buffered: number
  deduped: number
  updated: number
}

export type ProcessShippingWebhookInput = {
  provider: string
  provider_event_id: string
  provider_shipment_id?: string | null
  provider_awb?: string | null
  internal_reference?: string | null
  provider_order_id?: string | null
  event_type: string
  payload_sanitized?: Record<string, unknown> | null
  status?: ShipmentStatus | null
}

export type ProcessShippingWebhookResult = {
  processed: boolean
  deduped: boolean
  buffered: boolean
  matched: boolean
  shipment_id: string | null
  status_updated: boolean
}

export type ShippingShipmentRecord = {
  id: string
  order_id: string
  provider: string
  internal_reference: string
  provider_order_id: string | null
  provider_shipment_id: string | null
  provider_awb: string | null
  status: ShipmentStatus
  is_active: boolean
  replacement_of_shipment_id: string | null
  service_level: string | null
  courier_code: string | null
  rate_amount: number | null
  rate_currency: string | null
  label_url: string | null
  label_generated_at: Date | null
  label_expires_at: Date | null
  label_last_fetched_at: Date | null
  label_status: ShipmentLabelStatus
  created_at: Date
  updated_at: Date
}

export type ShippingEventRecord = {
  id: string
  shipment_id: string
  provider: string
  status: ShipmentStatus
  raw_status: string | null
  raw_payload_sanitized: Record<string, unknown> | null
  provider_event_id: string | null
  created_at: Date
  updated_at: Date
}

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value)
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed)
    }
  }

  return fallback
}

function mapWebhookBufferRow(
  row: Record<string, unknown>
): ShippingWebhookBufferRecord {
  return {
    id: readText(row.id),
    provider: readText(row.provider).toLowerCase(),
    provider_event_id: readText(row.provider_event_id),
    provider_shipment_id: readNullableText(row.provider_shipment_id),
    provider_awb: readNullableText(row.provider_awb),
    event_type: readText(row.event_type),
    payload_sanitized:
      row.payload_sanitized && typeof row.payload_sanitized === "object"
        ? (row.payload_sanitized as Record<string, unknown>)
        : null,
    received_at: toNullableDate(row.received_at) ?? nowDate(),
    processed_at: toNullableDate(row.processed_at),
    retry_count: Math.max(0, toInt(row.retry_count, 0)),
  }
}

const SHIPMENT_STATUS_ORDER: Record<ShipmentStatus, number> = {
  [ShipmentStatus.DRAFT]: 0,
  [ShipmentStatus.BOOKING_IN_PROGRESS]: 1,
  [ShipmentStatus.BOOKED]: 2,
  [ShipmentStatus.PICKUP_SCHEDULED]: 3,
  [ShipmentStatus.IN_TRANSIT]: 4,
  [ShipmentStatus.OFD]: 5,
  [ShipmentStatus.FAILED]: 6,
  [ShipmentStatus.RTO_INITIATED]: 7,
  [ShipmentStatus.RTO_IN_TRANSIT]: 8,
  [ShipmentStatus.RTO_DELIVERED]: 9,
  [ShipmentStatus.DELIVERED]: 10,
  [ShipmentStatus.CANCELLED]: 11,
}

function getStatusOrder(status: ShipmentStatus): number {
  return SHIPMENT_STATUS_ORDER[status] ?? 0
}

function getWebhookBackoffMs(retryCount: number): number {
  if (retryCount <= 0) {
    return 0
  }

  const minutes = Math.min(Math.pow(2, retryCount - 1), 60)
  return minutes * 60 * 1000
}

function normalizeStatusToken(value: unknown): string {
  return readText(value).toLowerCase().replace(/[\s-]+/g, "_")
}

function mapWebhookEventToShipmentStatus(
  eventType: string,
  payload: Record<string, unknown> | null
): ShipmentStatus | null {
  const candidates = [
    normalizeStatusToken(eventType),
    normalizeStatusToken(payload?.status),
    normalizeStatusToken(payload?.status_code),
    normalizeStatusToken(payload?.raw_status),
    normalizeStatusToken(payload?.event_type),
    normalizeStatusToken(payload?.event),
  ].filter(Boolean)

  for (const token of candidates) {
    if (token.includes("booking_in_progress")) {
      return ShipmentStatus.BOOKING_IN_PROGRESS
    }
    if (token.includes("booked") || token.includes("shipment_created")) {
      return ShipmentStatus.BOOKED
    }
    if (token.includes("pickup_scheduled") || token.includes("pickup_assigned")) {
      return ShipmentStatus.PICKUP_SCHEDULED
    }
    if (token === "ofd" || token.includes("out_for_delivery")) {
      return ShipmentStatus.OFD
    }
    if (
      token.includes("in_transit") ||
      token.includes("shipped") ||
      token.includes("manifested")
    ) {
      return ShipmentStatus.IN_TRANSIT
    }
    if (token.includes("rto_delivered")) {
      return ShipmentStatus.RTO_DELIVERED
    }
    if (token.includes("rto_in_transit")) {
      return ShipmentStatus.RTO_IN_TRANSIT
    }
    if (token.includes("rto_initiated")) {
      return ShipmentStatus.RTO_INITIATED
    }
    if (token.includes("delivered")) {
      return ShipmentStatus.DELIVERED
    }
    if (
      token.includes("cancelled") ||
      token.includes("canceled") ||
      token.includes("voided")
    ) {
      return ShipmentStatus.CANCELLED
    }
    if (
      token.includes("failed") ||
      token.includes("undelivered") ||
      token.includes("exception")
    ) {
      return ShipmentStatus.FAILED
    }
  }

  return null
}

function isUniqueConstraintViolation(
  error: unknown,
  constraintNames: string[]
): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ""

  if (message.includes("duplicate key value") || message.includes("unique")) {
    return true
  }

  for (const constraint of constraintNames) {
    if (message.includes(constraint.toLowerCase())) {
      return true
    }
  }

  return false
}

export class ShippingPersistenceRepository {
  private schemaEnsured = false

  constructor(private readonly pgConnection: PgConnectionLike) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) {
      return
    }

    await this.pgConnection.raw(`
      CREATE TABLE IF NOT EXISTS ${SHIPPING_SHIPMENTS_TABLE} (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        internal_reference TEXT NOT NULL UNIQUE,
        provider_order_id TEXT,
        provider_shipment_id TEXT,
        provider_awb TEXT,
        status TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        replacement_of_shipment_id TEXT REFERENCES ${SHIPPING_SHIPMENTS_TABLE}(id),
        service_level TEXT,
        courier_code TEXT,
        rate_amount NUMERIC,
        rate_currency TEXT,
        label_url TEXT,
        label_generated_at TIMESTAMPTZ,
        label_expires_at TIMESTAMPTZ,
        label_last_fetched_at TIMESTAMPTZ,
        label_status TEXT NOT NULL DEFAULT '${ShipmentLabelStatus.MISSING}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await this.pgConnection.raw(`
      ALTER TABLE ${SHIPPING_SHIPMENTS_TABLE}
      ADD COLUMN IF NOT EXISTS provider_order_id TEXT
    `)

    await this.pgConnection.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_shipments_active_order_provider
      ON ${SHIPPING_SHIPMENTS_TABLE} (order_id, provider)
      WHERE is_active = true
    `)

    await this.pgConnection.raw(`
      CREATE INDEX IF NOT EXISTS idx_shipping_shipments_provider_provider_shipment_id
      ON ${SHIPPING_SHIPMENTS_TABLE} (provider, provider_shipment_id)
    `)

    await this.pgConnection.raw(`
      CREATE INDEX IF NOT EXISTS idx_shipping_shipments_provider_provider_awb
      ON ${SHIPPING_SHIPMENTS_TABLE} (provider, provider_awb)
    `)

    await this.pgConnection.raw(`
      CREATE TABLE IF NOT EXISTS ${SHIPPING_EVENTS_TABLE} (
        id TEXT PRIMARY KEY,
        shipment_id TEXT NOT NULL REFERENCES ${SHIPPING_SHIPMENTS_TABLE}(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        raw_status TEXT,
        raw_payload_sanitized JSONB,
        provider_event_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await this.pgConnection.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_events_provider_event_id
      ON ${SHIPPING_EVENTS_TABLE} (provider, provider_event_id)
      WHERE provider_event_id IS NOT NULL
    `)

    await this.pgConnection.raw(`
      CREATE INDEX IF NOT EXISTS idx_shipping_events_shipment_id
      ON ${SHIPPING_EVENTS_TABLE} (shipment_id)
    `)

    await this.pgConnection.raw(`
      CREATE TABLE IF NOT EXISTS ${SHIPPING_WEBHOOK_BUFFER_TABLE} (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_event_id TEXT NOT NULL,
        provider_shipment_id TEXT,
        provider_awb TEXT,
        event_type TEXT NOT NULL,
        payload_sanitized JSONB,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        retry_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE (provider, provider_event_id)
      )
    `)

    await this.pgConnection.raw(`
      CREATE INDEX IF NOT EXISTS idx_shipping_webhook_buffer_provider_shipment
      ON ${SHIPPING_WEBHOOK_BUFFER_TABLE} (provider, provider_shipment_id)
    `)

    await this.pgConnection.raw(`
      CREATE INDEX IF NOT EXISTS idx_shipping_webhook_buffer_provider_awb
      ON ${SHIPPING_WEBHOOK_BUFFER_TABLE} (provider, provider_awb)
    `)

    await this.pgConnection.raw(`
      CREATE INDEX IF NOT EXISTS idx_shipping_webhook_buffer_pending
      ON ${SHIPPING_WEBHOOK_BUFFER_TABLE} (processed_at, received_at)
    `)

    this.schemaEnsured = true
  }

  async createShipment(
    input: CreateShippingShipmentInput
  ): Promise<ShippingShipmentRecord> {
    await this.ensureSchema()

    const id = readText(input.id) || `ship_${randomUUID().replace(/-/g, "")}`
    const orderId = readText(input.order_id)
    const provider = readText(input.provider).toLowerCase()
    const internalReference = readText(input.internal_reference)

    if (!orderId || !provider || !internalReference) {
      throw new ShippingPersistenceError(
        "SHIPPING_SHIPMENT_INVALID_INPUT",
        "order_id, provider, and internal_reference are required for shipment persistence."
      )
    }

    try {
      const result = await this.pgConnection.raw(
        `
          INSERT INTO ${SHIPPING_SHIPMENTS_TABLE} (
            id,
            order_id,
            provider,
            internal_reference,
            provider_order_id,
            provider_shipment_id,
            provider_awb,
            status,
            is_active,
            replacement_of_shipment_id,
            service_level,
            courier_code,
            rate_amount,
            rate_currency,
            label_url,
            label_generated_at,
            label_expires_at,
            label_last_fetched_at,
            label_status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *
        `,
        [
          id,
          orderId,
          provider,
          internalReference,
          readNullableText(input.provider_order_id),
          readNullableText(input.provider_shipment_id),
          readNullableText(input.provider_awb),
          input.status ?? ShipmentStatus.DRAFT,
          input.is_active ?? true,
          readNullableText(input.replacement_of_shipment_id),
          readNullableText(input.service_level),
          readNullableText(input.courier_code),
          input.rate_amount ?? null,
          readNullableText(input.rate_currency),
          readNullableText(input.label_url),
          input.label_generated_at ?? null,
          input.label_expires_at ?? null,
          input.label_last_fetched_at ?? null,
          input.label_status ?? ShipmentLabelStatus.MISSING,
        ]
      )

      const row = result.rows?.[0]
      if (!row) {
        throw new ShippingPersistenceError(
          "SHIPPING_SHIPMENT_INSERT_FAILED",
          "Failed to insert shipping shipment record."
        )
      }
      const created = mapShipmentRow(row)

      const shouldReplayBufferedEvents =
        input.replay_buffered_events !== false &&
        (Boolean(created.provider_shipment_id) || Boolean(created.provider_awb))

      if (shouldReplayBufferedEvents) {
        await this.replayBufferedEventsForShipment(created)
      }

      return created
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown shipment persistence error."
      const normalized = message.toLowerCase()

      if (
        normalized.includes("shipping_shipments_internal_reference_key") ||
        normalized.includes("internal_reference")
      ) {
        throw new ShippingPersistenceError(
          "SHIPPING_INTERNAL_REFERENCE_CONFLICT",
          `A shipment already exists for internal_reference ${internalReference}.`,
          {
            internal_reference: internalReference,
            order_id: orderId,
            provider,
          }
        )
      }

      if (
        isUniqueConstraintViolation(error, [
          "uq_shipping_shipments_active_order_provider",
        ]) ||
        normalized.includes("uq_shipping_shipments_active_order_provider")
      ) {
        throw new ShippingPersistenceError(
          "SHIPPING_ACTIVE_SHIPMENT_CONFLICT",
          `An active shipment already exists for order ${orderId} and provider ${provider}.`,
          {
            order_id: orderId,
            provider,
          }
        )
      }

      throw error
    }
  }

  async getShipmentById(shipmentId: string): Promise<ShippingShipmentRecord | null> {
    await this.ensureSchema()

    const id = readText(shipmentId)
    if (!id) {
      return null
    }

    const result = await this.pgConnection.raw(
      `SELECT * FROM ${SHIPPING_SHIPMENTS_TABLE} WHERE id = ?`,
      [id]
    )

    const row = result.rows?.[0]
    return row ? mapShipmentRow(row) : null
  }

  async getShipmentByInternalReference(
    internalReferenceInput: string
  ): Promise<ShippingShipmentRecord | null> {
    await this.ensureSchema()

    const internalReference = readText(internalReferenceInput)
    if (!internalReference) {
      return null
    }

    const result = await this.pgConnection.raw(
      `
        SELECT *
        FROM ${SHIPPING_SHIPMENTS_TABLE}
        WHERE internal_reference = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [internalReference]
    )

    const row = result.rows?.[0]
    return row ? mapShipmentRow(row) : null
  }

  async markShipmentBookedFromProvider(
    input: MarkShipmentBookedInput
  ): Promise<ShippingShipmentRecord | null> {
    await this.ensureSchema()

    const shipmentId = readText(input.shipment_id)
    if (!shipmentId) {
      return null
    }

    const status = input.status ?? ShipmentStatus.BOOKED
    const labelUrl = readNullableText(input.label_url)
    const labelGeneratedAt = input.label_generated_at ?? null
    const labelExpiresAt = input.label_expires_at ?? null
    const labelLastFetchedAt =
      input.label_last_fetched_at ??
      (labelUrl ? new Date().toISOString() : null)
    const labelStatus =
      input.label_status ??
      (labelUrl ? ShipmentLabelStatus.AVAILABLE : ShipmentLabelStatus.MISSING)

    const result = await this.pgConnection.raw(
      `
        UPDATE ${SHIPPING_SHIPMENTS_TABLE}
        SET
          provider_order_id = ?,
          provider_shipment_id = ?,
          provider_awb = ?,
          status = ?,
          label_url = ?,
          label_generated_at = ?,
          label_expires_at = ?,
          label_last_fetched_at = ?,
          label_status = ?,
          updated_at = NOW()
        WHERE id = ?
        RETURNING *
      `,
      [
        readNullableText(input.provider_order_id),
        readNullableText(input.provider_shipment_id),
        readNullableText(input.provider_awb),
        status,
        labelUrl,
        labelGeneratedAt,
        labelExpiresAt,
        labelLastFetchedAt,
        labelStatus,
        shipmentId,
      ]
    )

    const row = result.rows?.[0]
    return row ? mapShipmentRow(row) : null
  }

  async listStuckBookingInProgress(
    input: ListStuckBookingInProgressInput = {}
  ): Promise<ShippingShipmentRecord[]> {
    await this.ensureSchema()

    const limit = toPositiveInt(input.limit, 100)
    const olderThan =
      input.older_than instanceof Date &&
      Number.isFinite(input.older_than.getTime())
        ? input.older_than.toISOString()
        : new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const result = await this.pgConnection.raw(
      `
        SELECT *
        FROM ${SHIPPING_SHIPMENTS_TABLE}
        WHERE status = ?
          AND is_active = true
          AND created_at <= ?
        ORDER BY created_at ASC
        LIMIT ?
      `,
      [ShipmentStatus.BOOKING_IN_PROGRESS, olderThan, limit]
    )

    return (result.rows ?? []).map((row) => mapShipmentRow(row))
  }

  async listActiveShipments(
    orderId: string,
    provider: string
  ): Promise<ShippingShipmentRecord[]> {
    await this.ensureSchema()

    const result = await this.pgConnection.raw(
      `
        SELECT *
        FROM ${SHIPPING_SHIPMENTS_TABLE}
        WHERE order_id = ? AND provider = ? AND is_active = true
      `,
      [readText(orderId), readText(provider).toLowerCase()]
    )

    return (result.rows ?? []).map((row) => mapShipmentRow(row))
  }

  async listActiveShipmentsByStatuses(
    input: ListActiveShipmentsByStatusesInput
  ): Promise<ShippingShipmentRecord[]> {
    await this.ensureSchema()

    const statuses = Array.from(
      new Set(
        (input.statuses ?? [])
          .map((status) => readText(status))
          .filter(Boolean)
      )
    )
    if (statuses.length === 0) {
      return []
    }

    const provider = readText(input.provider).toLowerCase()
    const limit = toPositiveInt(input.limit, 100)
    const placeholders = statuses.map(() => "?").join(", ")
    const bindings: unknown[] = [...statuses]
    let providerClause = ""
    if (provider) {
      providerClause = " AND provider = ?"
      bindings.push(provider)
    }
    bindings.push(limit)

    const result = await this.pgConnection.raw(
      `
        SELECT *
        FROM ${SHIPPING_SHIPMENTS_TABLE}
        WHERE is_active = true
          AND status IN (${placeholders})
          ${providerClause}
        ORDER BY updated_at ASC
        LIMIT ?
      `,
      bindings
    )

    return (result.rows ?? []).map((row) => mapShipmentRow(row))
  }

  async touchShipmentUpdatedAt(input: {
    shipment_id: string
    updated_at?: Date
  }): Promise<ShippingShipmentRecord | null> {
    await this.ensureSchema()

    const shipmentId = readText(input.shipment_id)
    if (!shipmentId) {
      return null
    }

    const updatedAt =
      input.updated_at instanceof Date &&
      Number.isFinite(input.updated_at.getTime())
        ? input.updated_at.toISOString()
        : new Date().toISOString()

    const result = await this.pgConnection.raw(
      `
        UPDATE ${SHIPPING_SHIPMENTS_TABLE}
        SET updated_at = ?
        WHERE id = ?
        RETURNING *
      `,
      [updatedAt, shipmentId]
    )

    const row = result.rows?.[0]
    return row ? mapShipmentRow(row) : null
  }

  async markShipmentInactive(shipmentId: string): Promise<ShippingShipmentRecord | null> {
    await this.ensureSchema()

    const id = readText(shipmentId)
    if (!id) {
      return null
    }

    const result = await this.pgConnection.raw(
      `
        UPDATE ${SHIPPING_SHIPMENTS_TABLE}
        SET is_active = false, updated_at = NOW()
        WHERE id = ? AND is_active = true
        RETURNING *
      `,
      [id]
    )

    const row = result.rows?.[0]
    return row ? mapShipmentRow(row) : null
  }

  async rebookShipment(
    input: RebookShipmentInput
  ): Promise<{
    previous: ShippingShipmentRecord
    replacement: ShippingShipmentRecord
  }> {
    await this.ensureSchema()

    const previousId = readText(input.previous_shipment_id)
    if (!previousId) {
      throw new ShippingPersistenceError(
        "SHIPPING_REBOOK_INVALID_INPUT",
        "previous_shipment_id is required."
      )
    }

    const previous = await this.markShipmentInactive(previousId)
    if (!previous) {
      throw new ShippingPersistenceError(
        "SHIPPING_REBOOK_PREVIOUS_NOT_FOUND",
        `No active shipment found for id ${previousId}.`
      )
    }

    const replacement = await this.createShipment({
      ...input.replacement,
      order_id: previous.order_id,
      provider: previous.provider,
      replacement_of_shipment_id: previous.id,
      is_active: true,
    })

    return {
      previous,
      replacement,
    }
  }

  async appendEvent(input: CreateShippingEventInput): Promise<ShippingEventRecord> {
    await this.ensureSchema()

    const id = readText(input.id) || `sev_${randomUUID().replace(/-/g, "")}`
    const shipmentId = readText(input.shipment_id)
    const provider = readText(input.provider).toLowerCase()

    if (!shipmentId || !provider) {
      throw new ShippingPersistenceError(
        "SHIPPING_EVENT_INVALID_INPUT",
        "shipment_id and provider are required for shipping event persistence."
      )
    }

    const sanitizedPayload = sanitizeProviderPayload(
      provider,
      input.raw_payload_sanitized ?? null
    )

    let result: QueryResultLike
    try {
      result = await this.pgConnection.raw(
        `
          INSERT INTO ${SHIPPING_EVENTS_TABLE} (
            id,
            shipment_id,
            provider,
            status,
            raw_status,
            raw_payload_sanitized,
            provider_event_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING *
        `,
        [
          id,
          shipmentId,
          provider,
          input.status,
          readNullableText(input.raw_status),
          sanitizedPayload,
          readNullableText(input.provider_event_id),
        ]
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message.toLowerCase() : "unknown shipping event insert error"

      if (
        isUniqueConstraintViolation(error, [
          "uq_shipping_events_provider_event_id",
        ]) ||
        message.includes("uq_shipping_events_provider_event_id")
      ) {
        throw new ShippingPersistenceError(
          "SHIPPING_EVENT_DUPLICATE",
          "Shipping event already processed for provider event id.",
          {
            provider,
            provider_event_id: readNullableText(input.provider_event_id),
          }
        )
      }

      throw error
    }

    const row = result.rows?.[0]
    if (!row) {
      throw new ShippingPersistenceError(
        "SHIPPING_EVENT_INSERT_FAILED",
        "Failed to insert shipping event."
      )
    }

    return mapEventRow(row)
  }

  async getBufferedWebhookEvent(
    providerInput: string,
    providerEventIdInput: string
  ): Promise<ShippingWebhookBufferRecord | null> {
    await this.ensureSchema()

    const provider = readText(providerInput).toLowerCase()
    const providerEventId = readText(providerEventIdInput)
    if (!provider || !providerEventId) {
      return null
    }

    const result = await this.pgConnection.raw(
      `
        SELECT *
        FROM ${SHIPPING_WEBHOOK_BUFFER_TABLE}
        WHERE provider = ? AND provider_event_id = ?
        LIMIT 1
      `,
      [provider, providerEventId]
    )

    const row = result.rows?.[0]
    return row ? mapWebhookBufferRow(row) : null
  }

  async bufferWebhookEvent(input: BufferShippingWebhookInput): Promise<{
    buffered: boolean
    already_buffered: boolean
    record: ShippingWebhookBufferRecord | null
  }> {
    await this.ensureSchema()

    const id = readText(input.id) || `swb_${randomUUID().replace(/-/g, "")}`
    const provider = readText(input.provider).toLowerCase()
    const providerEventId = readText(input.provider_event_id)
    const eventType = readText(input.event_type)

    if (!provider || !providerEventId || !eventType) {
      throw new ShippingPersistenceError(
        "SHIPPING_WEBHOOK_BUFFER_INVALID_INPUT",
        "provider, provider_event_id, and event_type are required to buffer shipping webhook events."
      )
    }

    const sanitizedPayload = sanitizeProviderPayload(
      provider,
      input.payload_sanitized ?? null
    )

    const result = await this.pgConnection.raw(
      `
        INSERT INTO ${SHIPPING_WEBHOOK_BUFFER_TABLE} (
          id,
          provider,
          provider_event_id,
          provider_shipment_id,
          provider_awb,
          event_type,
          payload_sanitized
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (provider, provider_event_id) DO NOTHING
        RETURNING *
      `,
      [
        id,
        provider,
        providerEventId,
        readNullableText(input.provider_shipment_id),
        readNullableText(input.provider_awb),
        eventType,
        sanitizedPayload,
      ]
    )

    const insertedRow = result.rows?.[0]
    if (insertedRow) {
      return {
        buffered: true,
        already_buffered: false,
        record: mapWebhookBufferRow(insertedRow),
      }
    }

    const existing = await this.getBufferedWebhookEvent(provider, providerEventId)
    return {
      buffered: false,
      already_buffered: true,
      record: existing,
    }
  }

  async markBufferedWebhookProcessed(
    bufferIdInput: string,
    processedAtInput?: Date
  ): Promise<ShippingWebhookBufferRecord | null> {
    await this.ensureSchema()

    const bufferId = readText(bufferIdInput)
    if (!bufferId) {
      return null
    }

    const processedAt =
      processedAtInput instanceof Date &&
      Number.isFinite(processedAtInput.getTime())
        ? processedAtInput.toISOString()
        : new Date().toISOString()

    const result = await this.pgConnection.raw(
      `
        UPDATE ${SHIPPING_WEBHOOK_BUFFER_TABLE}
        SET processed_at = ?, retry_count = retry_count
        WHERE id = ?
        RETURNING *
      `,
      [processedAt, bufferId]
    )

    const row = result.rows?.[0]
    return row ? mapWebhookBufferRow(row) : null
  }

  async incrementBufferedWebhookRetry(
    bufferIdInput: string
  ): Promise<ShippingWebhookBufferRecord | null> {
    await this.ensureSchema()

    const bufferId = readText(bufferIdInput)
    if (!bufferId) {
      return null
    }

    const result = await this.pgConnection.raw(
      `
        UPDATE ${SHIPPING_WEBHOOK_BUFFER_TABLE}
        SET retry_count = retry_count + 1
        WHERE id = ?
        RETURNING *
      `,
      [bufferId]
    )

    const row = result.rows?.[0]
    return row ? mapWebhookBufferRow(row) : null
  }

  async findShipmentByProviderRefs(input: {
    provider: string
    provider_shipment_id?: string | null
    provider_awb?: string | null
    provider_order_id?: string | null
    internal_reference?: string | null
  }): Promise<ShippingShipmentRecord | null> {
    await this.ensureSchema()

    const provider = readText(input.provider).toLowerCase()
    const providerShipmentId = readNullableText(input.provider_shipment_id)
    const providerAwb = readNullableText(input.provider_awb)
    const providerOrderId = readNullableText(input.provider_order_id)
    const internalReference = readNullableText(input.internal_reference)

    if (
      !provider ||
      (!providerShipmentId && !providerAwb && !providerOrderId && !internalReference)
    ) {
      return null
    }

    if (providerShipmentId) {
      const byShipmentId = await this.pgConnection.raw(
        `
          SELECT *
          FROM ${SHIPPING_SHIPMENTS_TABLE}
          WHERE provider = ? AND provider_shipment_id = ?
          ORDER BY is_active DESC, created_at DESC
          LIMIT 1
        `,
        [provider, providerShipmentId]
      )
      const row = byShipmentId.rows?.[0]
      if (row) {
        return mapShipmentRow(row)
      }
    }

    if (providerAwb) {
      const byAwb = await this.pgConnection.raw(
        `
          SELECT *
          FROM ${SHIPPING_SHIPMENTS_TABLE}
          WHERE provider = ? AND provider_awb = ?
          ORDER BY is_active DESC, created_at DESC
          LIMIT 1
        `,
        [provider, providerAwb]
      )
      const row = byAwb.rows?.[0]
      if (row) {
        return mapShipmentRow(row)
      }
    }

    if (providerOrderId) {
      const byProviderOrderId = await this.pgConnection.raw(
        `
          SELECT *
          FROM ${SHIPPING_SHIPMENTS_TABLE}
          WHERE provider = ? AND provider_order_id = ?
          ORDER BY is_active DESC, created_at DESC
          LIMIT 1
        `,
        [provider, providerOrderId]
      )
      const row = byProviderOrderId.rows?.[0]
      if (row) {
        return mapShipmentRow(row)
      }
    }

    if (internalReference) {
      const byInternalReference = await this.pgConnection.raw(
        `
          SELECT *
          FROM ${SHIPPING_SHIPMENTS_TABLE}
          WHERE internal_reference = ?
          ORDER BY is_active DESC, created_at DESC
          LIMIT 1
        `,
        [internalReference]
      )
      const row = byInternalReference.rows?.[0]
      if (row) {
        return mapShipmentRow(row)
      }
    }

    return null
  }

  async updateShipmentStatusMonotonic(input: {
    shipment_id: string
    next_status: ShipmentStatus
  }): Promise<{
    updated: boolean
    shipment: ShippingShipmentRecord | null
  }> {
    await this.ensureSchema()

    const shipmentId = readText(input.shipment_id)
    if (!shipmentId) {
      return {
        updated: false,
        shipment: null,
      }
    }

    const current = await this.getShipmentById(shipmentId)
    if (!current) {
      return {
        updated: false,
        shipment: null,
      }
    }

    const currentOrder = getStatusOrder(current.status)
    const nextOrder = getStatusOrder(input.next_status)
    if (nextOrder <= currentOrder) {
      return {
        updated: false,
        shipment: current,
      }
    }

    const result = await this.pgConnection.raw(
      `
        UPDATE ${SHIPPING_SHIPMENTS_TABLE}
        SET status = ?, updated_at = NOW()
        WHERE id = ?
        RETURNING *
      `,
      [input.next_status, shipmentId]
    )

    const row = result.rows?.[0]
    return {
      updated: Boolean(row),
      shipment: row ? mapShipmentRow(row) : current,
    }
  }

  async processShippingWebhookEvent(
    input: ProcessShippingWebhookInput
  ): Promise<ProcessShippingWebhookResult> {
    await this.ensureSchema()

    const provider = readText(input.provider).toLowerCase()
    const providerEventId = readText(input.provider_event_id)
    const eventType = readText(input.event_type)

    if (!provider || !providerEventId || !eventType) {
      throw new ShippingPersistenceError(
        "SHIPPING_WEBHOOK_INVALID_INPUT",
        "provider, provider_event_id, and event_type are required for shipping webhook processing."
      )
    }

    const payload = sanitizeProviderPayload(provider, input.payload_sanitized ?? null)
    const shipment = await this.findShipmentByProviderRefs({
      provider,
      provider_shipment_id: input.provider_shipment_id,
      provider_awb: input.provider_awb,
      provider_order_id: input.provider_order_id,
      internal_reference: input.internal_reference,
    })

    if (!shipment) {
      const buffered = await this.bufferWebhookEvent({
        provider,
        provider_event_id: providerEventId,
        provider_shipment_id: input.provider_shipment_id,
        provider_awb: input.provider_awb,
        provider_order_id: input.provider_order_id,
        internal_reference: input.internal_reference,
        event_type: eventType,
        payload_sanitized: payload,
      })

      return {
        processed: false,
        deduped: buffered.already_buffered,
        buffered: true,
        matched: false,
        shipment_id: null,
        status_updated: false,
      }
    }

    const mappedStatus =
      input.status ?? mapWebhookEventToShipmentStatus(eventType, payload)
    const eventStatus = mappedStatus ?? shipment.status

    let deduped = false
    try {
      await this.appendEvent({
        shipment_id: shipment.id,
        provider,
        status: eventStatus,
        raw_status: eventType,
        raw_payload_sanitized: payload,
        provider_event_id: providerEventId,
      })
    } catch (error) {
      if (
        error instanceof ShippingPersistenceError &&
        error.code === "SHIPPING_EVENT_DUPLICATE"
      ) {
        deduped = true
      } else {
        throw error
      }
    }

    let statusUpdated = false
    if (mappedStatus) {
      const statusUpdate = await this.updateShipmentStatusMonotonic({
        shipment_id: shipment.id,
        next_status: mappedStatus,
      })
      statusUpdated = statusUpdate.updated
    }

    return {
      processed: !deduped,
      deduped,
      buffered: false,
      matched: true,
      shipment_id: shipment.id,
      status_updated: statusUpdated,
    }
  }

  private async listPendingWebhookBufferRecords(
    limitInput: number
  ): Promise<ShippingWebhookBufferRecord[]> {
    const limit = toPositiveInt(
      limitInput,
      DEFAULT_SHIPPING_WEBHOOK_REPLAY_BATCH_SIZE
    )

    const result = await this.pgConnection.raw(
      `
        SELECT *
        FROM ${SHIPPING_WEBHOOK_BUFFER_TABLE}
        WHERE processed_at IS NULL
        ORDER BY received_at ASC
        LIMIT ?
      `,
      [limit]
    )

    return (result.rows ?? []).map((row) => mapWebhookBufferRow(row))
  }

  private async listPendingWebhookBufferForShipment(
    shipment: ShippingShipmentRecord,
    limitInput: number
  ): Promise<ShippingWebhookBufferRecord[]> {
    const limit = toPositiveInt(
      limitInput,
      DEFAULT_SHIPPING_WEBHOOK_REPLAY_BATCH_SIZE
    )
    const records: ShippingWebhookBufferRecord[] = []
    const seen = new Set<string>()

    if (shipment.provider_shipment_id) {
      const byShipmentId = await this.pgConnection.raw(
        `
          SELECT *
          FROM ${SHIPPING_WEBHOOK_BUFFER_TABLE}
          WHERE provider = ?
            AND provider_shipment_id = ?
            AND processed_at IS NULL
          ORDER BY received_at ASC
          LIMIT ?
        `,
        [shipment.provider, shipment.provider_shipment_id, limit]
      )
      for (const row of byShipmentId.rows ?? []) {
        const mapped = mapWebhookBufferRow(row)
        if (!seen.has(mapped.id)) {
          seen.add(mapped.id)
          records.push(mapped)
        }
      }
    }

    if (shipment.provider_awb) {
      const byAwb = await this.pgConnection.raw(
        `
          SELECT *
          FROM ${SHIPPING_WEBHOOK_BUFFER_TABLE}
          WHERE provider = ?
            AND provider_awb = ?
            AND processed_at IS NULL
          ORDER BY received_at ASC
          LIMIT ?
        `,
        [shipment.provider, shipment.provider_awb, limit]
      )
      for (const row of byAwb.rows ?? []) {
        const mapped = mapWebhookBufferRow(row)
        if (!seen.has(mapped.id)) {
          seen.add(mapped.id)
          records.push(mapped)
        }
      }
    }

    records.sort((a, b) => a.received_at.getTime() - b.received_at.getTime())
    return records.slice(0, limit)
  }

  private async processBufferedWebhookRecord(input: {
    record: ShippingWebhookBufferRecord
    shipment: ShippingShipmentRecord
    processed_at?: Date
  }): Promise<{
    processed: boolean
    deduped: boolean
    updated: boolean
  }> {
    const mappedStatus = mapWebhookEventToShipmentStatus(
      input.record.event_type,
      input.record.payload_sanitized
    )
    const eventStatus = mappedStatus ?? input.shipment.status
    let processed = false
    let deduped = false

    try {
      await this.appendEvent({
        shipment_id: input.shipment.id,
        provider: input.record.provider,
        status: eventStatus,
        raw_status: input.record.event_type,
        raw_payload_sanitized: input.record.payload_sanitized,
        provider_event_id: input.record.provider_event_id,
      })
      processed = true
    } catch (error) {
      if (
        error instanceof ShippingPersistenceError &&
        error.code === "SHIPPING_EVENT_DUPLICATE"
      ) {
        deduped = true
      } else {
        throw error
      }
    }

    let updated = false
    if (mappedStatus) {
      const statusUpdate = await this.updateShipmentStatusMonotonic({
        shipment_id: input.shipment.id,
        next_status: mappedStatus,
      })
      updated = statusUpdate.updated
    }

    await this.markBufferedWebhookProcessed(
      input.record.id,
      input.processed_at
    )

    return {
      processed,
      deduped,
      updated,
    }
  }

  async replayBufferedEventsForShipment(
    shipmentInput: Pick<
      ShippingShipmentRecord,
      "id" | "provider" | "provider_shipment_id" | "provider_awb" | "status"
    >,
    input: ReplayBufferedEventsInput = {}
  ): Promise<ReplayBufferedEventsResult> {
    await this.ensureSchema()

    const shipment =
      (await this.getShipmentById(shipmentInput.id)) ??
      ({
        ...shipmentInput,
      } as ShippingShipmentRecord)

    const now =
      input.now instanceof Date && Number.isFinite(input.now.getTime())
        ? input.now
        : new Date()
    const limit = toPositiveInt(
      input.limit,
      DEFAULT_SHIPPING_WEBHOOK_REPLAY_BATCH_SIZE
    )

    const records = await this.listPendingWebhookBufferForShipment(
      shipment,
      limit
    )
    const result: ReplayBufferedEventsResult = {
      scanned: records.length,
      processed: 0,
      buffered: 0,
      deduped: 0,
      updated: 0,
    }

    for (const record of records) {
      const processedRecord = await this.processBufferedWebhookRecord({
        record,
        shipment,
        processed_at: now,
      })

      if (processedRecord.processed) {
        result.processed += 1
      }
      if (processedRecord.deduped) {
        result.deduped += 1
      }
      if (processedRecord.updated) {
        result.updated += 1
      }
    }

    return result
  }

  async replayBufferedEvents(
    input: ReplayBufferedEventsInput = {}
  ): Promise<ReplayBufferedEventsResult> {
    await this.ensureSchema()

    const now =
      input.now instanceof Date && Number.isFinite(input.now.getTime())
        ? input.now
        : new Date()
    const limit = toPositiveInt(
      input.limit,
      DEFAULT_SHIPPING_WEBHOOK_REPLAY_BATCH_SIZE
    )

    const candidates = await this.listPendingWebhookBufferRecords(limit)
    const result: ReplayBufferedEventsResult = {
      scanned: 0,
      processed: 0,
      buffered: 0,
      deduped: 0,
      updated: 0,
    }

    for (const record of candidates) {
      if (result.scanned >= limit) {
        break
      }

      const backoffMs = getWebhookBackoffMs(record.retry_count)
      const isDue =
        now.getTime() - record.received_at.getTime() >= backoffMs
      if (!isDue) {
        continue
      }

      result.scanned += 1
      const shipment = await this.findShipmentByProviderRefs({
        provider: record.provider,
        provider_shipment_id: record.provider_shipment_id,
        provider_awb: record.provider_awb,
        provider_order_id: readNullableText(record.payload_sanitized?.provider_order_id),
        internal_reference:
          readNullableText(record.payload_sanitized?.internal_reference) ||
          readNullableText(record.payload_sanitized?.order_id),
      })

      if (!shipment) {
        await this.incrementBufferedWebhookRetry(record.id)
        result.buffered += 1
        continue
      }

      const processedRecord = await this.processBufferedWebhookRecord({
        record,
        shipment,
        processed_at: now,
      })
      if (processedRecord.processed) {
        result.processed += 1
      }
      if (processedRecord.deduped) {
        result.deduped += 1
      }
      if (processedRecord.updated) {
        result.updated += 1
      }
    }

    return result
  }

  async purgeExpiredSanitizedPayloads(
    input: PurgeShippingEventsPayloadInput = {}
  ): Promise<{
    ttl_days: number
    cutoff_at: Date
    scrubbed_count: number
  }> {
    await this.ensureSchema()

    const configuredTtl = toPositiveInt(
      input.ttl_days ?? process.env.SHIPPING_EVENTS_PAYLOAD_TTL_DAYS,
      DEFAULT_SHIPPING_EVENTS_PAYLOAD_TTL_DAYS
    )

    const now = input.now instanceof Date && Number.isFinite(input.now.getTime())
      ? input.now
      : new Date()
    const cutoffAt = new Date(now.getTime() - configuredTtl * 24 * 60 * 60 * 1000)

    const result = await this.pgConnection.raw(
      `
        UPDATE ${SHIPPING_EVENTS_TABLE}
        SET raw_payload_sanitized = NULL, updated_at = NOW()
        WHERE raw_payload_sanitized IS NOT NULL
          AND created_at < ?
        RETURNING id
      `,
      [cutoffAt.toISOString()]
    )

    return {
      ttl_days: configuredTtl,
      cutoff_at: cutoffAt,
      scrubbed_count: Array.isArray(result.rows) ? result.rows.length : 0,
    }
  }
}
