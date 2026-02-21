import crypto from "crypto"
import {
  ShipmentStatus,
  type CancelRequest,
  type CancelResponse,
  type CreateShipmentRequest,
  type CreateShipmentResponse,
  type GetLabelRequest,
  type HealthCheckResponse,
  type LabelResponse,
  type LookupShipmentByReferenceRequest,
  type ProviderCapabilities,
  type QuoteRequest,
  type QuoteResponse,
  type ShippingProvider,
  type TrackRequest,
  type TrackingResponse,
  validateCancelRequest,
  validateCreateShipmentRequest,
  validateGetLabelRequest,
  validateLookupShipmentByReferenceRequest,
  validateQuoteRequest,
  validateTrackRequest,
} from "./provider-contract"

const FAKE_PROVIDER_ID = "fake"
const FAKE_BASE_URL = "https://fake-provider.local"
const DEFAULT_LABEL_TTL_HOURS = 24
const cancelledShipmentIds = new Set<string>()

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function nowIso(): string {
  return new Date().toISOString()
}

function digest(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function normalizeReference(input: string): string {
  return readText(input).toLowerCase()
}

function computeShipmentId(reference: string): string {
  return `fake_shp_${digest(reference).slice(0, 16)}`
}

function computeTrackingNumber(reference: string): string {
  return `FAKE${digest(reference).slice(0, 12).toUpperCase()}`
}

function labelExpiryIso(createdAtIso: string): string {
  const createdAtMs = new Date(createdAtIso).getTime()
  const expiresAtMs = createdAtMs + DEFAULT_LABEL_TTL_HOURS * 60 * 60 * 1000
  return new Date(expiresAtMs).toISOString()
}

function deriveStatus(identifier: string): ShipmentStatus {
  const token = digest(identifier).slice(0, 1)
  const nibble = Number.parseInt(token, 16)
  if (!Number.isFinite(nibble)) {
    return ShipmentStatus.BOOKED
  }

  if (nibble <= 3) {
    return ShipmentStatus.BOOKED
  }
  if (nibble <= 7) {
    return ShipmentStatus.IN_TRANSIT
  }
  if (nibble <= 11) {
    return ShipmentStatus.OFD
  }
  return ShipmentStatus.DELIVERED
}

function buildTrackingEvents(status: ShipmentStatus): TrackingResponse["events"] {
  const now = new Date()
  const createEvent = (eventStatus: ShipmentStatus, offsetHours: number) => ({
    status: eventStatus,
    occurred_at: new Date(now.getTime() - offsetHours * 60 * 60 * 1000).toISOString(),
    message: `fake:${eventStatus.toLowerCase()}`,
    raw_status: eventStatus,
  })

  if (status === ShipmentStatus.DELIVERED) {
    return [
      createEvent(ShipmentStatus.BOOKED, 18),
      createEvent(ShipmentStatus.IN_TRANSIT, 8),
      createEvent(ShipmentStatus.OFD, 3),
      createEvent(ShipmentStatus.DELIVERED, 0),
    ]
  }

  if (status === ShipmentStatus.OFD) {
    return [
      createEvent(ShipmentStatus.BOOKED, 12),
      createEvent(ShipmentStatus.IN_TRANSIT, 5),
      createEvent(ShipmentStatus.OFD, 0),
    ]
  }

  if (status === ShipmentStatus.IN_TRANSIT) {
    return [
      createEvent(ShipmentStatus.BOOKED, 8),
      createEvent(ShipmentStatus.IN_TRANSIT, 0),
    ]
  }

  return [createEvent(ShipmentStatus.BOOKED, 0)]
}

function buildLabel(shipmentId: string): LabelResponse {
  const createdAt = nowIso()
  return {
    shipment_id: shipmentId,
    label_url: `${FAKE_BASE_URL}/labels/${shipmentId}.pdf`,
    mime_type: "application/pdf",
    label_expires_at: labelExpiryIso(createdAt),
    regenerated: false,
  }
}

export class FakeShippingProvider implements ShippingProvider {
  readonly provider = FAKE_PROVIDER_ID

  readonly capabilities: ProviderCapabilities = {
    supports_cod: true,
    supports_reverse: false,
    supports_label_regen: true,
    supports_webhooks: false,
    supports_cancel: true,
    supports_multi_piece: true,
    supports_idempotency: true,
    supports_reference_lookup: true,
  }

  async quote(input: QuoteRequest): Promise<QuoteResponse> {
    const valid = validateQuoteRequest(input)
    const totalWeight = valid.parcels.reduce(
      (sum, parcel) => sum + parcel.weight_grams,
      0
    )
    const codFee = valid.cod?.enabled ? 50 : 0
    const price = Math.max(99, Math.round(totalWeight / 100) + codFee)

    return {
      quotes: [
        {
          service_code: "fake_standard",
          service_name: "Fake Standard",
          price,
          currency_code: valid.currency_code,
          eta_days: 4,
          cod_supported: true,
          metadata: {
            provider: this.provider,
          },
        },
      ],
    }
  }

  async createShipment(input: CreateShipmentRequest): Promise<CreateShipmentResponse> {
    const valid = validateCreateShipmentRequest(input)
    const reference = normalizeReference(valid.internal_reference)
    const shipmentId = computeShipmentId(reference)
    const trackingNumber = computeTrackingNumber(reference)
    const bookedAt = nowIso()

    return {
      shipment_id: shipmentId,
      tracking_number: trackingNumber,
      tracking_url: `${FAKE_BASE_URL}/tracking/${trackingNumber}`,
      status: ShipmentStatus.BOOKED,
      label: {
        ...buildLabel(shipmentId),
        regenerated: false,
      },
      booked_at: bookedAt,
      metadata: {
        provider: this.provider,
        internal_reference: valid.internal_reference,
        provider_order_id: valid.internal_reference,
      },
    }
  }

  async findShipmentByReference(
    input: LookupShipmentByReferenceRequest
  ): Promise<CreateShipmentResponse | null> {
    const valid = validateLookupShipmentByReferenceRequest(input)
    if (!readText(valid.internal_reference)) {
      return null
    }

    const shipment = await this.createShipment({
      internal_reference: valid.internal_reference,
      idempotency_key: valid.internal_reference,
      order_reference: valid.internal_reference,
      currency_code: "INR",
      pickup_address: {
        name: "Fake Pickup",
        phone: "9999999999",
        line1: "Line 1",
        city: "Chennai",
        state: "TN",
        postal_code: "600001",
        country_code: "IN",
      },
      delivery_address: {
        name: "Fake Delivery",
        phone: "9999999999",
        line1: "Line 1",
        city: "Chennai",
        state: "TN",
        postal_code: "600001",
        country_code: "IN",
      },
      parcels: [
        {
          weight_grams: 100,
          dimensions_cm: { l: 10, w: 10, h: 10 },
        },
      ],
      line_items: [{ sku: "FAKE-SKU", name: "Fake Item", qty: 1 }],
      cod: { enabled: false, amount: 0 },
      correlation_id: valid.correlation_id,
    })

    return shipment
  }

  async getLabel(input: GetLabelRequest): Promise<LabelResponse> {
    const valid = validateGetLabelRequest(input)
    return buildLabel(valid.shipment_id)
  }

  async track(input: TrackRequest): Promise<TrackingResponse> {
    const valid = validateTrackRequest(input)
    const identifier =
      readText(valid.tracking_number) ||
      readText(valid.shipment_id) ||
      readText(valid.internal_reference)
    const status = cancelledShipmentIds.has(identifier)
      ? ShipmentStatus.CANCELLED
      : deriveStatus(identifier)

    return {
      shipment_id: readText(valid.shipment_id) || computeShipmentId(identifier),
      tracking_number:
        readText(valid.tracking_number) || computeTrackingNumber(identifier),
      status,
      events: buildTrackingEvents(status),
    }
  }

  async cancel(input: CancelRequest): Promise<CancelResponse> {
    const valid = validateCancelRequest(input)
    cancelledShipmentIds.add(valid.shipment_id)

    return {
      shipment_id: valid.shipment_id,
      cancelled: true,
      status: ShipmentStatus.CANCELLED,
      cancelled_at: nowIso(),
    }
  }

  async healthCheck(): Promise<HealthCheckResponse> {
    return {
      ok: true,
      provider: this.provider,
      checked_at: nowIso(),
      details: {
        mode: "fake",
      },
    }
  }
}

export function __resetFakeShippingProviderStateForTests(): void {
  cancelledShipmentIds.clear()
}
