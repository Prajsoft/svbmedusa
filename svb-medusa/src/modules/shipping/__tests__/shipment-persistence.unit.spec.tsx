import {
  ShippingPersistenceRepository,
  ShipmentLabelStatus,
} from "../shipment-persistence"
import { ShipmentStatus } from "../../../integrations/carriers/provider-contract"

describe("ShippingPersistenceRepository", () => {
  beforeEach(() => {
    ;(ShippingPersistenceRepository as any).schemaEnsured = true
    ;(ShippingPersistenceRepository as any).schemaEnsuring = null
  })

  afterEach(() => {
    ;(ShippingPersistenceRepository as any).schemaEnsured = false
    ;(ShippingPersistenceRepository as any).schemaEnsuring = null
  })

  it("does not overwrite a newer status when monotonic update loses race", async () => {
    let selectCount = 0
    const raw = jest.fn(async (query: string, bindings?: unknown[]) => {
      if (query.includes("SELECT * FROM shipping_shipments WHERE id = ?")) {
        selectCount += 1
        if (selectCount === 1) {
          return {
            rows: [
              {
                id: "ship_1",
                order_id: "order_1",
                provider: "shiprocket",
                internal_reference: "order_1:1",
                provider_order_id: "order_1:1",
                provider_shipment_id: "sr_1",
                provider_awb: "AWB1",
                status: ShipmentStatus.BOOKED,
                is_active: true,
                label_status: ShipmentLabelStatus.AVAILABLE,
                created_at: "2026-02-19T00:00:00.000Z",
                updated_at: "2026-02-19T00:00:00.000Z",
              },
            ],
          }
        }

        return {
          rows: [
            {
              id: "ship_1",
              order_id: "order_1",
              provider: "shiprocket",
              internal_reference: "order_1:1",
              provider_order_id: "order_1:1",
              provider_shipment_id: "sr_1",
              provider_awb: "AWB1",
              status: ShipmentStatus.DELIVERED,
              is_active: true,
              label_status: ShipmentLabelStatus.AVAILABLE,
              created_at: "2026-02-19T00:00:00.000Z",
              updated_at: "2026-02-19T01:00:00.000Z",
            },
          ],
        }
      }

      if (query.includes("UPDATE shipping_shipments")) {
        expect(bindings).toEqual([
          ShipmentStatus.IN_TRANSIT,
          "ship_1",
          ShipmentStatus.BOOKED,
        ])
        return { rows: [] }
      }

      throw new Error(`Unexpected SQL: ${query}`)
    })

    const repository = new ShippingPersistenceRepository({
      raw,
    } as any)

    const result = await repository.updateShipmentStatusMonotonic({
      shipment_id: "ship_1",
      next_status: ShipmentStatus.IN_TRANSIT,
    })

    expect(result.updated).toBe(false)
    expect(result.shipment?.status).toBe(ShipmentStatus.DELIVERED)
  })

  it("persists provider_order_id and internal_reference when buffering webhooks", async () => {
    const raw = jest.fn(async (query: string, bindings?: unknown[]) => {
      if (query.includes("INSERT INTO shipping_webhook_buffer")) {
        expect(bindings?.[5]).toBe("sr_order_123")
        expect(bindings?.[6]).toBe("order_abc:1")

        return {
          rows: [
            {
              id: "swb_1",
              provider: "shiprocket",
              provider_event_id: "evt_1",
              provider_shipment_id: "sr_ship_1",
              provider_awb: "AWB1001",
              provider_order_id: "sr_order_123",
              internal_reference: "order_abc:1",
              event_type: "in_transit",
              payload_sanitized: { shipment_status_id: 6 },
              received_at: "2026-02-19T00:00:00.000Z",
              processed_at: null,
              retry_count: 0,
            },
          ],
        }
      }

      throw new Error(`Unexpected SQL: ${query}`)
    })

    const repository = new ShippingPersistenceRepository({
      raw,
    } as any)

    const result = await repository.bufferWebhookEvent({
      provider: "shiprocket",
      provider_event_id: "evt_1",
      provider_shipment_id: "sr_ship_1",
      provider_awb: "AWB1001",
      provider_order_id: "sr_order_123",
      internal_reference: "order_abc:1",
      event_type: "in_transit",
      payload_sanitized: { shipment_status_id: 6 },
    })

    expect(result.buffered).toBe(true)
    expect(result.record).toEqual(
      expect.objectContaining({
        provider_order_id: "sr_order_123",
        internal_reference: "order_abc:1",
      })
    )
  })
})

