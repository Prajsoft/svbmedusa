import crypto from "crypto"
import type { ShipmentContract } from "../../modules/shipping/build-shipment-contract"
import type {
  CancelShipmentResult,
  CarrierAdapter,
  CarrierTrackingStatus,
  CreateShipmentResult,
  GetTrackingResult,
} from "./types"

const FAKE_BASE_URL = "https://fake-carrier.local"
const DEFAULT_TRACKING_START = "2026-01-01T00:00:00.000Z"

const cancelledShipmentIds = new Set<string>()

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null"
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value)
  }

  if (typeof value === "string") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`
  }

  if (typeof value === "object") {
    const record = value as Record<string, JsonValue>
    const keys = Object.keys(record).sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`
  }

  return JSON.stringify(String(value))
}

function digest(input: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(input)).digest("hex")
}

function toIsoAtIndex(index: number): string {
  const start = new Date(DEFAULT_TRACKING_START).getTime()
  const stepMillis = 6 * 60 * 60 * 1000
  return new Date(start + index * stepMillis).toISOString()
}

function getDeterministicStatus(identifier: string): CarrierTrackingStatus {
  const hash = digest(identifier)
  const step = parseInt(hash[0], 16) % 4

  if (step === 0) {
    return "requested"
  }

  if (step === 1) {
    return "ready_for_shipment"
  }

  if (step === 2) {
    return "shipped"
  }

  return "delivered"
}

function buildHistory(status: CarrierTrackingStatus) {
  const sequence: CarrierTrackingStatus[] = []

  if (status === "requested") {
    sequence.push("requested")
  } else if (status === "ready_for_shipment") {
    sequence.push("requested", "ready_for_shipment")
  } else if (status === "shipped") {
    sequence.push("requested", "ready_for_shipment", "shipped")
  } else if (status === "delivered") {
    sequence.push("requested", "ready_for_shipment", "shipped", "delivered")
  } else if (status === "delivery_failed") {
    sequence.push("requested", "ready_for_shipment", "delivery_failed")
  } else if (status === "rto_initiated") {
    sequence.push("requested", "ready_for_shipment", "delivery_failed", "rto_initiated")
  } else if (status === "rto_delivered") {
    sequence.push(
      "requested",
      "ready_for_shipment",
      "delivery_failed",
      "rto_initiated",
      "rto_delivered"
    )
  } else {
    sequence.push("unknown")
  }

  return sequence.map((entry, index) => ({
    status: entry,
    timestamp: toIsoAtIndex(index),
    note: `fake:${entry}`,
  }))
}

function resolveTrackingIdentifier(input: {
  carrier_shipment_id?: string
  tracking_number?: string
}): string {
  const byShipmentId = input.carrier_shipment_id?.trim()
  if (byShipmentId) {
    return byShipmentId
  }

  const byTracking = input.tracking_number?.trim()
  if (byTracking) {
    return byTracking
  }

  throw new Error("Either carrier_shipment_id or tracking_number is required.")
}

export class FakeCarrierAdapter implements CarrierAdapter {
  async createShipment(
    shipmentContract: ShipmentContract
  ): Promise<CreateShipmentResult> {
    const hash = digest(shipmentContract)
    const shipmentId = `fake_shp_${hash.slice(0, 12)}`
    const trackingNumber = `FAKE${hash.slice(0, 12).toUpperCase()}`

    return {
      carrier_shipment_id: shipmentId,
      label_url: `${FAKE_BASE_URL}/labels/${shipmentId}.pdf`,
      tracking_number: trackingNumber,
    }
  }

  async cancelShipment(
    carrier_shipment_id: string
  ): Promise<CancelShipmentResult> {
    cancelledShipmentIds.add(carrier_shipment_id)
    return { cancelled: true }
  }

  async getTracking(input: {
    carrier_shipment_id?: string
    tracking_number?: string
  }): Promise<GetTrackingResult> {
    const identifier = resolveTrackingIdentifier(input)
    const status = cancelledShipmentIds.has(identifier)
      ? "delivery_failed"
      : getDeterministicStatus(identifier)

    return {
      status,
      history: buildHistory(status),
    }
  }

  verifyWebhook(request: {
    headers: Record<string, string | string[] | undefined>
    raw_body: string
    body?: unknown
  }): boolean {
    const headerValue = request.headers["x-fake-carrier-signature"]
    const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue
    return typeof signature === "string" && signature.length > 0
  }
}

export function __resetFakeCarrierStateForTests(): void {
  cancelledShipmentIds.clear()
}
