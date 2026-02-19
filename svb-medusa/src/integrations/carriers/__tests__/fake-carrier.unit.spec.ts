import type { ShipmentContract } from "../../../modules/shipping/build-shipment-contract"
import { __resetFakeCarrierStateForTests, FakeCarrierAdapter } from "../fake-carrier"
import { CarrierAdapterConfigError, getCarrierAdapter } from "../index"

function makeContract(): ShipmentContract {
  return {
    order_id: "order_01",
    pickup_location_code: "WH-MRT-01",
    pickup_address: {
      name: "SVB Sports Warehouse",
      phone: "9999999999",
      line1: "Warehouse street",
      city: "Chennai",
      state: "TN",
      postal_code: "600001",
      country_code: "IN",
    },
    delivery_address: {
      name: "Prash K",
      phone: "8888888888",
      line1: "Delivery street",
      city: "Bengaluru",
      state: "KA",
      postal_code: "560001",
      country_code: "IN",
    },
    packages: [
      {
        weight_grams: 520,
        dimensions_cm: { l: 12, w: 7, h: 14 },
        items: [
          { sku: "SVB-CRB-SWFP-WHT-P01", qty: 1, name: "Swift Plus Ball" },
          { sku: "SVB-CRB-BLTZP-RED-P12", qty: 2, name: "Blitz Plus Ball" },
        ],
      },
    ],
    cod: {
      enabled: true,
      amount: 1499,
    },
    invoice_ref: "1001",
    notes: "test",
  }
}

describe("FakeCarrierAdapter", () => {
  beforeEach(() => {
    __resetFakeCarrierStateForTests()
  })

  it("createShipment returns deterministic IDs and label URL", async () => {
    const adapter = new FakeCarrierAdapter()
    const contract = makeContract()

    const first = await adapter.createShipment(contract)
    const second = await adapter.createShipment(contract)

    expect(first).toEqual(second)
    expect(first.carrier_shipment_id).toMatch(/^fake_shp_[a-f0-9]{12}$/)
    expect(first.label_url).toBe(
      `https://fake-carrier.local/labels/${first.carrier_shipment_id}.pdf`
    )
    expect(first.tracking_number).toMatch(/^FAKE[A-F0-9]{12}$/)
  })

  it("cancelShipment works and tracking reflects cancelled state", async () => {
    const adapter = new FakeCarrierAdapter()
    const created = await adapter.createShipment(makeContract())

    const cancel = await adapter.cancelShipment(created.carrier_shipment_id)
    const tracking = await adapter.getTracking({
      carrier_shipment_id: created.carrier_shipment_id,
    })

    expect(cancel).toEqual({ cancelled: true })
    expect(tracking.status).toBe("delivery_failed")
    expect(tracking.history[tracking.history.length - 1]?.status).toBe(
      "delivery_failed"
    )
  })
})

describe("carrier adapter selection", () => {
  const originalCarrierAdapter = process.env.CARRIER_ADAPTER
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.CARRIER_ADAPTER = originalCarrierAdapter
    process.env.NODE_ENV = originalNodeEnv
  })

  it("defaults to fake adapter in non-production when CARRIER_ADAPTER is unset", () => {
    delete process.env.CARRIER_ADAPTER
    process.env.NODE_ENV = "development"

    const adapter = getCarrierAdapter()
    expect(adapter).toBeInstanceOf(FakeCarrierAdapter)
  })

  it("throws for unsupported adapter values", () => {
    process.env.CARRIER_ADAPTER = "unknown_adapter"
    process.env.NODE_ENV = "development"

    expect(() => getCarrierAdapter()).toThrow(CarrierAdapterConfigError)
  })
})
