import crypto from "crypto"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST as shiprocketWebhookRoute } from "../route"
import { ShipmentStatus } from "../../../../../integrations/carriers/provider-contract"
import {
  SHIPPING_EVENTS_TABLE,
  SHIPPING_SHIPMENTS_TABLE,
  SHIPPING_WEBHOOK_BUFFER_TABLE,
} from "../../../../../modules/shipping/shipment-persistence"
import { runShippingWebhookReplay } from "../../../../../modules/shipping/webhook-replay"

type QueryResultLike = {
  rows?: Array<Record<string, unknown>>
}

type ShipmentRow = {
  id: string
  order_id: string
  provider: string
  internal_reference: string
  provider_shipment_id: string | null
  provider_awb: string | null
  status: string
  is_active: boolean
  replacement_of_shipment_id: string | null
  service_level: string | null
  courier_code: string | null
  rate_amount: number | null
  rate_currency: string | null
  label_url: string | null
  label_generated_at: string | null
  label_expires_at: string | null
  label_last_fetched_at: string | null
  label_status: string
  created_at: string
  updated_at: string
}

type EventRow = {
  id: string
  shipment_id: string
  provider: string
  status: string
  raw_status: string | null
  raw_payload_sanitized: Record<string, unknown> | null
  provider_event_id: string | null
  created_at: string
  updated_at: string
}

type WebhookBufferRow = {
  id: string
  provider: string
  provider_event_id: string
  provider_shipment_id: string | null
  provider_awb: string | null
  provider_order_id: string | null
  internal_reference: string | null
  event_type: string
  payload_sanitized: Record<string, unknown> | null
  received_at: string
  processed_at: string | null
  retry_count: number
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim()
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    payload: undefined as unknown,
    headers: {} as Record<string, string>,
    status: jest.fn(function (code: number) {
      res.statusCode = code
      return res
    }),
    json: jest.fn(function (body: unknown) {
      res.payload = body
      return res
    }),
    setHeader: jest.fn(function (key: string, value: string) {
      res.headers[key] = value
    }),
  }

  return res
}

function getLoggedMessages(mockFn: jest.Mock): string[] {
  return mockFn.mock.calls
    .map((call) => {
      const line = call[0]
      if (typeof line !== "string") {
        return ""
      }
      try {
        const parsed = JSON.parse(line) as { message?: unknown }
        return typeof parsed.message === "string" ? parsed.message : ""
      } catch {
        return ""
      }
    })
    .filter(Boolean)
}

function deriveShiprocketWebhookEventId(body: Record<string, unknown>): string {
  const data =
    body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : {}
  const shipment =
    data.shipment && typeof data.shipment === "object" && !Array.isArray(data.shipment)
      ? (data.shipment as Record<string, unknown>)
      : {}
  const shipmentDetails =
    data.shipment_details &&
    typeof data.shipment_details === "object" &&
    !Array.isArray(data.shipment_details)
      ? (data.shipment_details as Record<string, unknown>)
      : {}

  const first = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim()
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(Math.floor(value))
      }
    }
    return ""
  }

  const awb = first(
    body.awb,
    body.awb_code,
    body.tracking_number,
    data.awb,
    data.awb_code,
    shipment.awb,
    shipment.awb_code,
    shipmentDetails.awb,
    shipmentDetails.awb_code
  )
  const currentTimestamp = first(
    body.current_timestamp,
    data.current_timestamp,
    shipment.current_timestamp,
    shipmentDetails.current_timestamp,
    body.current_status_datetime,
    data.current_status_datetime,
    body.updated_at,
    data.updated_at
  )
  const currentStatusId = first(
    body.current_status_id,
    data.current_status_id,
    shipment.current_status_id,
    shipmentDetails.current_status_id
  )
  const shipmentStatusId = first(
    body.shipment_status_id,
    data.shipment_status_id,
    shipment.shipment_status_id,
    shipmentDetails.shipment_status_id
  )

  const seed = `${awb}|${currentTimestamp}|${currentStatusId}|${shipmentStatusId}`
  const material = seed === "|||" ? JSON.stringify(body) : seed
  const digest = crypto.createHash("sha256").update(material).digest("hex")
  return `srwh_${digest}`
}

function makeHarness() {
  const shipments: ShipmentRow[] = []
  const events: EventRow[] = []
  const webhookBuffer: WebhookBufferRow[] = []
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  const raw = jest.fn(
    async (query: string, bindings: unknown[] = []): Promise<QueryResultLike> => {
      const sql = normalizeSql(query)

      if (
        sql.startsWith("CREATE TABLE") ||
        sql.startsWith("CREATE UNIQUE INDEX") ||
        sql.startsWith("CREATE INDEX")
      ) {
        return { rows: [] }
      }

      if (
        sql.startsWith(`SELECT * FROM ${SHIPPING_SHIPMENTS_TABLE}`) &&
        sql.includes("provider = ?") &&
        sql.includes("provider_shipment_id = ?") &&
        sql.includes("LIMIT 1")
      ) {
        const provider = String(bindings[0] ?? "").trim().toLowerCase()
        const providerShipmentId = String(bindings[1] ?? "").trim()
        const row = shipments.find(
          (entry) =>
            entry.provider === provider &&
            (entry.provider_shipment_id ?? "") === providerShipmentId
        )
        return { rows: row ? [row] : [] }
      }

      if (
        sql.startsWith(`SELECT * FROM ${SHIPPING_SHIPMENTS_TABLE}`) &&
        sql.includes("provider = ?") &&
        sql.includes("provider_awb = ?") &&
        sql.includes("LIMIT 1")
      ) {
        const provider = String(bindings[0] ?? "").trim().toLowerCase()
        const providerAwb = String(bindings[1] ?? "").trim()
        const row = shipments.find(
          (entry) =>
            entry.provider === provider && (entry.provider_awb ?? "") === providerAwb
        )
        return { rows: row ? [row] : [] }
      }

      if (sql.startsWith(`SELECT * FROM ${SHIPPING_SHIPMENTS_TABLE} WHERE id = ?`)) {
        const id = String(bindings[0] ?? "").trim()
        const row = shipments.find((entry) => entry.id === id)
        return { rows: row ? [row] : [] }
      }

      if (
        sql.startsWith(`UPDATE ${SHIPPING_SHIPMENTS_TABLE}`) &&
        sql.includes("SET status = ?") &&
        sql.includes("WHERE id = ?")
      ) {
        const nextStatus = String(bindings[0] ?? "").trim()
        const id = String(bindings[1] ?? "").trim()
        const row = shipments.find((entry) => entry.id === id)
        if (!row) {
          return { rows: [] }
        }
        row.status = nextStatus
        row.updated_at = nowIso()
        return { rows: [row] }
      }

      if (sql.startsWith(`INSERT INTO ${SHIPPING_EVENTS_TABLE}`)) {
        const [
          id,
          shipmentId,
          provider,
          status,
          rawStatus,
          rawPayloadSanitized,
          providerEventId,
        ] = bindings

        const normalizedProvider = String(provider ?? "").trim().toLowerCase()
        const normalizedEventId =
          providerEventId === null ? null : String(providerEventId).trim()
        if (
          normalizedEventId &&
          events.some(
            (entry) =>
              entry.provider === normalizedProvider &&
              entry.provider_event_id === normalizedEventId
          )
        ) {
          throw new Error(
            'duplicate key value violates unique constraint "uq_shipping_events_provider_event_id"'
          )
        }

        const row: EventRow = {
          id: String(id),
          shipment_id: String(shipmentId),
          provider: normalizedProvider,
          status: String(status),
          raw_status: rawStatus === null ? null : String(rawStatus),
          raw_payload_sanitized:
            rawPayloadSanitized && typeof rawPayloadSanitized === "object"
              ? (rawPayloadSanitized as Record<string, unknown>)
              : null,
          provider_event_id: normalizedEventId,
          created_at: nowIso(),
          updated_at: nowIso(),
        }
        events.push(row)
        return { rows: [row] }
      }

      if (sql.startsWith(`INSERT INTO ${SHIPPING_WEBHOOK_BUFFER_TABLE}`)) {
        const [
          id,
          provider,
          providerEventId,
          providerShipmentId,
          providerAwb,
          providerOrderId,
          internalReference,
          eventType,
          payloadSanitized,
        ] = bindings

        const normalizedProvider = String(provider ?? "").trim().toLowerCase()
        const normalizedEventId = String(providerEventId ?? "").trim()
        const exists = webhookBuffer.some(
          (entry) =>
            entry.provider === normalizedProvider &&
            entry.provider_event_id === normalizedEventId
        )
        if (exists) {
          return { rows: [] }
        }

        const row: WebhookBufferRow = {
          id: String(id),
          provider: normalizedProvider,
          provider_event_id: normalizedEventId,
          provider_shipment_id:
            providerShipmentId === null ? null : String(providerShipmentId),
          provider_awb: providerAwb === null ? null : String(providerAwb),
          provider_order_id:
            providerOrderId === null ? null : String(providerOrderId),
          internal_reference:
            internalReference === null ? null : String(internalReference),
          event_type: String(eventType ?? ""),
          payload_sanitized:
            payloadSanitized && typeof payloadSanitized === "object"
              ? (payloadSanitized as Record<string, unknown>)
              : null,
          received_at: nowIso(),
          processed_at: null,
          retry_count: 0,
        }
        webhookBuffer.push(row)
        return { rows: [row] }
      }

      if (
        sql.startsWith("SELECT *") &&
        sql.includes(`FROM ${SHIPPING_WEBHOOK_BUFFER_TABLE}`) &&
        sql.includes("provider = ?") &&
        sql.includes("provider_event_id = ?")
      ) {
        const provider = String(bindings[0] ?? "").trim().toLowerCase()
        const providerEventId = String(bindings[1] ?? "").trim()
        const row = webhookBuffer.find(
          (entry) =>
            entry.provider === provider &&
            entry.provider_event_id === providerEventId
        )
        return { rows: row ? [row] : [] }
      }

      if (
        sql.startsWith(`SELECT *`) &&
        sql.includes(`FROM ${SHIPPING_WEBHOOK_BUFFER_TABLE}`) &&
        sql.includes("processed_at IS NULL") &&
        sql.includes("provider_shipment_id = ?")
      ) {
        const provider = String(bindings[0] ?? "").trim().toLowerCase()
        const providerShipmentId = String(bindings[1] ?? "").trim()
        const limit = Number(bindings[2] ?? 100)
        const rows = webhookBuffer
          .filter(
            (entry) =>
              entry.provider === provider &&
              entry.processed_at === null &&
              (entry.provider_shipment_id ?? "") === providerShipmentId
          )
          .slice(0, limit)
        return { rows }
      }

      if (
        sql.startsWith(`SELECT *`) &&
        sql.includes(`FROM ${SHIPPING_WEBHOOK_BUFFER_TABLE}`) &&
        sql.includes("processed_at IS NULL") &&
        sql.includes("provider_awb = ?")
      ) {
        const provider = String(bindings[0] ?? "").trim().toLowerCase()
        const providerAwb = String(bindings[1] ?? "").trim()
        const limit = Number(bindings[2] ?? 100)
        const rows = webhookBuffer
          .filter(
            (entry) =>
              entry.provider === provider &&
              entry.processed_at === null &&
              (entry.provider_awb ?? "") === providerAwb
          )
          .slice(0, limit)
        return { rows }
      }

      if (
        sql.startsWith(`SELECT *`) &&
        sql.includes(`FROM ${SHIPPING_WEBHOOK_BUFFER_TABLE}`) &&
        sql.includes("processed_at IS NULL") &&
        sql.includes("ORDER BY received_at ASC") &&
        sql.includes("LIMIT ?")
      ) {
        const limit = Number(bindings[0] ?? 100)
        const rows = webhookBuffer
          .filter((entry) => entry.processed_at === null)
          .sort(
            (a, b) =>
              new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
          )
          .slice(0, limit)
        return { rows }
      }

      if (
        sql.startsWith(`UPDATE ${SHIPPING_WEBHOOK_BUFFER_TABLE}`) &&
        sql.includes("SET processed_at = ?")
      ) {
        const processedAt = String(bindings[0] ?? "")
        const id = String(bindings[1] ?? "")
        const row = webhookBuffer.find((entry) => entry.id === id)
        if (!row) {
          return { rows: [] }
        }
        row.processed_at = processedAt
        return { rows: [row] }
      }

      if (
        sql.startsWith(`UPDATE ${SHIPPING_WEBHOOK_BUFFER_TABLE}`) &&
        sql.includes("SET retry_count = retry_count + 1")
      ) {
        const id = String(bindings[0] ?? "")
        const row = webhookBuffer.find((entry) => entry.id === id)
        if (!row) {
          return { rows: [] }
        }
        row.retry_count += 1
        return { rows: [row] }
      }

      return { rows: [] }
    }
  )

  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.PG_CONNECTION) {
        return { raw }
      }
      if (key === ContainerRegistrationKeys.LOGGER || key === "logger") {
        return logger
      }
      return undefined
    },
  }

  return {
    scope,
    logger,
    shipments,
    events,
    webhookBuffer,
  }
}

function addShipment(
  rows: ShipmentRow[],
  input: {
    id: string
    provider_shipment_id: string
    provider_awb?: string
    status?: string
  }
) {
  const now = nowIso()
  rows.push({
    id: input.id,
    order_id: `order_${input.id}`,
    provider: "shiprocket",
    internal_reference: `order_${input.id}_shiprocket_1`,
    provider_shipment_id: input.provider_shipment_id,
    provider_awb: input.provider_awb ?? null,
    status: input.status ?? ShipmentStatus.BOOKED,
    is_active: true,
    replacement_of_shipment_id: null,
    service_level: null,
    courier_code: null,
    rate_amount: null,
    rate_currency: null,
    label_url: null,
    label_generated_at: null,
    label_expires_at: null,
    label_last_fetched_at: null,
    label_status: "MISSING",
    created_at: now,
    updated_at: now,
  })
}

function makeReq(
  scope: any,
  input: {
    body: Record<string, unknown>
    headers?: Record<string, string>
  }
) {
  const rawBody = JSON.stringify(input.body)
  return {
    body: input.body,
    rawBody: Buffer.from(rawBody),
    headers: input.headers ?? {},
    scope,
  } as any
}

describe("Shiprocket shipping webhook route", () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.resetAllMocks()
    process.env = {
      ...OLD_ENV,
      SHIPROCKET_WEBHOOK_TOKEN: "shiprocket_token_test",
      ALLOW_UNSIGNED_WEBHOOKS: "false",
    }
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  it("processes verified webhook when shipment is matched", async () => {
    const harness = makeHarness()
    addShipment(harness.shipments, {
      id: "ship_1",
      provider_shipment_id: "sr_ship_1",
      provider_awb: "awb_1",
      status: ShipmentStatus.BOOKED,
    })

    const body = {
      event: "in_transit",
      shipment_id: "sr_ship_1",
      awb_code: "awb_1",
      status: "In Transit",
      current_timestamp: "2026-02-21T00:00:00.000Z",
      current_status_id: 6,
      shipment_status_id: 6,
    }
    const req = makeReq(harness.scope, {
      body,
      headers: {
        "anx-api-key": "shiprocket_token_test",
      },
    })
    const res = makeRes()

    await shiprocketWebhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.payload).toEqual(
      expect.objectContaining({
        ok: true,
        provider: "shiprocket",
        event_id: deriveShiprocketWebhookEventId(body),
        processed: true,
        buffered: false,
        matched: true,
        shipment_id: "ship_1",
        security_mode: "verified",
      })
    )
    expect(harness.events).toHaveLength(1)
    expect(harness.shipments[0].status).toBe(ShipmentStatus.IN_TRANSIT)
    expect(getLoggedMessages(harness.logger.info as jest.Mock)).toContain(
      "SHIPPING_WEBHOOK_RECEIVED"
    )
  })

  it("buffers verified webhook when shipment is not found", async () => {
    const harness = makeHarness()
    const body = {
      event: "in_transit",
      shipment_id: "sr_ship_missing",
      awb_code: "awb_missing",
      status: "In Transit",
      current_timestamp: "2026-02-21T00:05:00.000Z",
      current_status_id: 6,
      shipment_status_id: 6,
    }
    const req = makeReq(harness.scope, {
      body,
      headers: {
        "anx-api-key": "shiprocket_token_test",
      },
    })
    const res = makeRes()

    await shiprocketWebhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.payload).toEqual(
      expect.objectContaining({
        ok: true,
        provider: "shiprocket",
        event_id: deriveShiprocketWebhookEventId(body),
        processed: false,
        buffered: true,
        matched: false,
        shipment_id: null,
      })
    )
    expect(harness.webhookBuffer).toHaveLength(1)
    expect(harness.webhookBuffer[0].processed_at).toBeNull()
  })

  it("rejects webhook when token verification fails", async () => {
    const harness = makeHarness()

    const body = {
      event: "in_transit",
      shipment_id: "sr_ship_invalid",
      awb_code: "awb_invalid",
      status: "In Transit",
      current_timestamp: "2026-02-21T00:10:00.000Z",
      current_status_id: 6,
      shipment_status_id: 6,
    }
    const req = makeReq(harness.scope, {
      body,
      headers: {
        "anx-api-key": "invalid_token",
      },
    })
    const res = makeRes()

    await shiprocketWebhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.payload).toEqual({
      error: {
        code: "SIGNATURE_INVALID",
        message: "Invalid shipping webhook token.",
        details: {
          provider: "shiprocket",
          provider_event_id: deriveShiprocketWebhookEventId(body),
        },
        correlation_id: expect.any(String),
      },
    })
  })

  it("accepts unverified webhook only when override is enabled and logs degraded security", async () => {
    const harness = makeHarness()
    process.env.ALLOW_UNSIGNED_WEBHOOKS = "true"

    const body = {
      event: "in_transit",
      shipment_id: "sr_ship_override",
      awb_code: "awb_override",
      status: "In Transit",
    }
    const req = makeReq(harness.scope, {
      body,
      headers: {
        "anx-api-key": "invalid_token",
      },
    })
    const res = makeRes()

    await shiprocketWebhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.payload).toEqual(
      expect.objectContaining({
        ok: true,
        processed: false,
        buffered: true,
        security_mode: "degraded",
      })
    )
    expect(harness.webhookBuffer).toHaveLength(1)
    expect(harness.webhookBuffer[0].payload_sanitized).toEqual(
      expect.objectContaining({
        provider: "shiprocket",
        webhook_security: "degraded",
        security_mode: "allow_unsigned_webhooks_override",
      })
    )
    expect(getLoggedMessages(harness.logger.warn as jest.Mock)).toContain(
      "WEBHOOK_SECURITY_DEGRADED"
    )
  })

  it("replays buffered webhook after shipment is created and drains buffer", async () => {
    const harness = makeHarness()
    const body = {
      event: "delivered",
      shipment_id: "sr_ship_replay_1",
      awb_code: "awb_replay_1",
      status: "Delivered",
      current_timestamp: "2026-02-21T00:20:00.000Z",
      current_status_id: 7,
      shipment_status_id: 7,
    }
    const req = makeReq(harness.scope, {
      body,
      headers: {
        "anx-api-key": "shiprocket_token_test",
      },
    })
    const res = makeRes()

    await shiprocketWebhookRoute(req, res)
    expect(harness.webhookBuffer).toHaveLength(1)
    expect(harness.events).toHaveLength(0)

    addShipment(harness.shipments, {
      id: "ship_replay_1",
      provider_shipment_id: "sr_ship_replay_1",
      provider_awb: "awb_replay_1",
      status: ShipmentStatus.BOOKED,
    })

    const replay = await runShippingWebhookReplay(harness.scope as any, {
      now: new Date("2099-01-01T00:00:00.000Z"),
      limit: 20,
    })

    expect(replay).toEqual({
      scanned: 1,
      processed: 1,
      buffered: 0,
      deduped: 0,
      updated: 1,
    })
    expect(harness.webhookBuffer[0].processed_at).not.toBeNull()
    expect(harness.events).toHaveLength(1)
    expect(
      harness.shipments.find((entry) => entry.id === "ship_replay_1")?.status
    ).toBe(ShipmentStatus.DELIVERED)
  })

  it("dedupes duplicate webhook payloads by derived provider_event_id hash", async () => {
    const harness = makeHarness()
    addShipment(harness.shipments, {
      id: "ship_dedupe_1",
      provider_shipment_id: "sr_ship_dedupe_1",
      provider_awb: "awb_dedupe_1",
      status: ShipmentStatus.BOOKED,
    })

    const body = {
      event: "in_transit",
      shipment_id: "sr_ship_dedupe_1",
      awb_code: "awb_dedupe_1",
      status: "In Transit",
      current_timestamp: "2026-02-21T00:30:00.000Z",
      current_status_id: 6,
      shipment_status_id: 6,
    }
    const firstReq = makeReq(harness.scope, {
      body,
      headers: {
        "anx-api-key": "shiprocket_token_test",
      },
    })
    const firstRes = makeRes()
    await shiprocketWebhookRoute(firstReq, firstRes)

    const secondReq = makeReq(harness.scope, {
      body,
      headers: {
        "anx-api-key": "shiprocket_token_test",
      },
    })
    const secondRes = makeRes()
    await shiprocketWebhookRoute(secondReq, secondRes)

    expect(firstRes.status).toHaveBeenCalledWith(200)
    expect(secondRes.status).toHaveBeenCalledWith(200)
    expect(secondRes.payload).toEqual(
      expect.objectContaining({
        deduped: true,
        matched: true,
        buffered: false,
      })
    )
  })

  it("maps sample Shiprocket status-id payload to normalized delivered state", async () => {
    const harness = makeHarness()
    addShipment(harness.shipments, {
      id: "ship_status_id_1",
      provider_shipment_id: "sr_ship_status_id_1",
      provider_awb: "awb_status_id_1",
      status: ShipmentStatus.BOOKED,
    })

    const body = {
      shipment_id: "sr_ship_status_id_1",
      awb_code: "awb_status_id_1",
      current_timestamp: "2026-02-21T00:40:00.000Z",
      current_status_id: 7,
      shipment_status_id: 7,
      event: "tracking_update",
    }
    const req = makeReq(harness.scope, {
      body,
      headers: {
        "anx-api-key": "shiprocket_token_test",
      },
    })
    const res = makeRes()

    await shiprocketWebhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].status).toBe(ShipmentStatus.DELIVERED)
    expect(
      harness.shipments.find((entry) => entry.id === "ship_status_id_1")?.status
    ).toBe(ShipmentStatus.DELIVERED)
  })
})
