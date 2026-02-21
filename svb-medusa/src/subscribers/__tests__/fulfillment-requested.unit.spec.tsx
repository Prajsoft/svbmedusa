import { createFulfillmentRequestedHandler } from "../fulfillment-requested"

const emitBusinessEventMock = jest.fn(async () => undefined)

jest.mock("../../modules/logging/business-events", () => ({
  emitBusinessEvent: (...args: unknown[]) => emitBusinessEventMock(...args),
}))

function makeOrder() {
  return {
    id: "order_1",
    display_id: 1001,
    currency_code: "inr",
    email: "ops@svb.test",
    metadata: {
      fulfillment_intents_v1: {
        "order_1:1": {
          fulfillment_attempt: 1,
          state: "requested",
        },
      },
    },
    shipping_address: {
      first_name: "A",
      last_name: "B",
      phone: "9999999999",
      address_1: "Line 1",
      city: "Chennai",
      province: "TN",
      postal_code: "600001",
      country_code: "IN",
    },
    items: [
      {
        id: "item_1",
        title: "Ball",
        quantity: 1,
        variant: {
          id: "var_1",
          sku: "SVB-BALL-1",
          metadata: {
            shipping_class: "SMALL",
            weight_grams: 160,
            dimensions_cm: { l: 10, w: 10, h: 10 },
          },
        },
      },
    ],
    payment_collections: [
      {
        payments: [
          {
            provider_id: "pp_cod_cod",
            amount: 1499,
          },
        ],
      },
    ],
  }
}

function makeShipmentContract() {
  return {
    order_id: "order_1",
    pickup_location_code: "WH-MRT-01",
    pickup_address: {
      name: "Warehouse",
      phone: "9999999999",
      line1: "WH line 1",
      city: "Chennai",
      state: "TN",
      postal_code: "600001",
      country_code: "IN",
    },
    delivery_address: {
      name: "Customer",
      phone: "9999999999",
      line1: "Customer line 1",
      city: "Chennai",
      state: "TN",
      postal_code: "600001",
      country_code: "IN",
    },
    packages: [
      {
        weight_grams: 160,
        dimensions_cm: { l: 10, w: 10, h: 10 },
        items: [
          {
            sku: "SVB-BALL-1",
            qty: 1,
            name: "Ball",
          },
        ],
      },
    ],
    cod: {
      enabled: true,
      amount: 1499,
    },
    invoice_ref: "1001",
  }
}

describe("fulfillment.requested subscriber", () => {
  const originalBookingEnabled = process.env.SHIPPING_BOOKING_ENABLED

  beforeEach(() => {
    emitBusinessEventMock.mockReset()
    process.env.SHIPPING_BOOKING_ENABLED = "true"
  })

  afterAll(() => {
    process.env.SHIPPING_BOOKING_ENABLED = originalBookingEnabled
  })

  it("books shipment and persists provider identifiers", async () => {
    const repository = {
      listActiveShipments: jest.fn(async () => []),
      createShipment: jest.fn(async () => ({
        id: "ship_1",
        order_id: "order_1",
        provider: "fake",
      })),
      markShipmentBookedFromProvider: jest.fn(async () => ({
        id: "ship_1",
        order_id: "order_1",
        provider: "fake",
        provider_shipment_id: "fake_shp_1",
      })),
      replayBufferedEventsForShipment: jest.fn(async () => ({
        scanned: 0,
        processed: 0,
        buffered: 0,
        deduped: 0,
        updated: 0,
      })),
    }

    const router = {
      getDefaultProviderId: jest.fn(() => "fake"),
      createShipment: jest.fn(async () => ({
        shipment_id: "fake_shp_1",
        tracking_number: "FAKE123",
        status: "BOOKED",
        label: {
          shipment_id: "fake_shp_1",
          label_url: "https://fake-provider.local/labels/fake_shp_1.pdf",
        },
        booked_at: "2026-02-20T12:00:00.000Z",
        metadata: {
          provider_order_id: "ship_order_1_1",
        },
      })),
    }

    const handler = createFulfillmentRequestedHandler({
      loadOrder: jest.fn(async () => makeOrder() as any),
      buildContract: jest.fn(() => makeShipmentContract() as any),
      createRouter: jest.fn(() => ({
        repository: repository as any,
        router: router as any,
      })),
    })

    await expect(
      handler({
        event: { data: { order_id: "order_1", correlation_id: "corr_1" } },
        container: {
          resolve: jest.fn(() => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          })),
        },
      } as any)
    ).resolves.toBeUndefined()

    expect(repository.createShipment).toHaveBeenCalledTimes(1)
    expect(router.createShipment).toHaveBeenCalledTimes(1)
    expect(repository.markShipmentBookedFromProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        shipment_id: "ship_1",
        provider_shipment_id: "fake_shp_1",
        provider_awb: "FAKE123",
      })
    )
    expect(emitBusinessEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "shipping.shipment_booked",
      })
    )
  })

  it("is idempotent when an active shipment already exists", async () => {
    const repository = {
      listActiveShipments: jest.fn(async () => [
        {
          id: "ship_existing",
          provider: "fake",
        },
      ]),
    }
    const router = {
      getDefaultProviderId: jest.fn(() => "fake"),
      createShipment: jest.fn(),
    }

    const handler = createFulfillmentRequestedHandler({
      loadOrder: jest.fn(async () => makeOrder() as any),
      buildContract: jest.fn(() => makeShipmentContract() as any),
      createRouter: jest.fn(() => ({
        repository: repository as any,
        router: router as any,
      })),
    })

    await expect(
      handler({
        event: { data: { order_id: "order_1" } },
        container: {
          resolve: jest.fn(() => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          })),
        },
      } as any)
    ).resolves.toBeUndefined()

    expect(router.createShipment).not.toHaveBeenCalled()
  })

  it("does not throw when booking is disabled", async () => {
    process.env.SHIPPING_BOOKING_ENABLED = "false"

    const repository = {
      listActiveShipments: jest.fn(async () => []),
      createShipment: jest.fn(async () => ({
        id: "ship_1",
        order_id: "order_1",
        provider: "fake",
      })),
    }
    const router = {
      getDefaultProviderId: jest.fn(() => "fake"),
      createShipment: jest.fn(async () => {
        const error = new Error("booking disabled")
        ;(error as Error & { code: string }).code = "BOOKING_DISABLED"
        throw error
      }),
    }

    const handler = createFulfillmentRequestedHandler({
      loadOrder: jest.fn(async () => makeOrder() as any),
      buildContract: jest.fn(() => makeShipmentContract() as any),
      createRouter: jest.fn(() => ({
        repository: repository as any,
        router: router as any,
      })),
    })

    await expect(
      handler({
        event: { data: { order_id: "order_1" } },
        container: {
          resolve: jest.fn(() => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          })),
        },
      } as any)
    ).resolves.toBeUndefined()

    expect(repository.createShipment).not.toHaveBeenCalled()
    expect(router.createShipment).not.toHaveBeenCalled()
  })
})
