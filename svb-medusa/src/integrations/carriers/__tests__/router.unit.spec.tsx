import { ShippingProviderRouter } from "../router"
import {
  ShipmentStatus,
  ShippingProviderError,
  type CreateShipmentRequest,
  type QuoteRequest,
  type ShippingProvider,
} from "../provider-contract"

function makeAddress() {
  return {
    name: "SVB Warehouse",
    phone: "9999999999",
    line1: "Street 1",
    city: "Chennai",
    state: "TN",
    postal_code: "600001",
    country_code: "IN",
  }
}

function makeQuoteRequest(): QuoteRequest {
  return {
    currency_code: "INR",
    pickup_address: makeAddress(),
    delivery_address: makeAddress(),
    parcels: [
      {
        weight_grams: 500,
        dimensions_cm: {
          l: 10,
          w: 10,
          h: 10,
        },
      },
    ],
  }
}

function makeCreateShipmentRequest(): CreateShipmentRequest {
  return {
    internal_reference: "order_1_ship_1",
    idempotency_key: "idmp_order_1_ship_1",
    order_reference: "order_1",
    currency_code: "INR",
    pickup_address: makeAddress(),
    delivery_address: makeAddress(),
    parcels: [
      {
        weight_grams: 500,
        dimensions_cm: {
          l: 10,
          w: 10,
          h: 10,
        },
      },
    ],
    line_items: [
      {
        sku: "SVB-CRB-SWFP-WHT-P01",
        name: "Swift Plus",
        qty: 1,
      },
    ],
    cod: {
      enabled: false,
      amount: 0,
    },
  }
}

function makeProvider(overrides: Partial<ShippingProvider> = {}): ShippingProvider {
  return {
    provider: "fake",
    capabilities: {
      supports_cod: true,
      supports_reverse: true,
      supports_label_regen: true,
      supports_webhooks: true,
      supports_cancel: true,
      supports_multi_piece: true,
      supports_idempotency: true,
      supports_reference_lookup: true,
    },
    quote: jest.fn().mockResolvedValue({ quotes: [] }),
    createShipment: jest.fn().mockResolvedValue({
      shipment_id: "provider_shp_1",
      status: ShipmentStatus.BOOKED,
    }),
    getLabel: jest.fn().mockResolvedValue({
      shipment_id: "provider_shp_1",
      label_url: "https://example.com/label.pdf",
      mime_type: "application/pdf",
      regenerated: false,
    }),
    track: jest.fn().mockResolvedValue({
      shipment_id: "provider_shp_1",
      status: ShipmentStatus.IN_TRANSIT,
      events: [],
    }),
    cancel: jest.fn().mockResolvedValue({
      shipment_id: "provider_shp_1",
      cancelled: true,
      status: ShipmentStatus.CANCELLED,
    }),
    healthCheck: jest.fn().mockResolvedValue({
      ok: true,
      provider: "fake",
      checked_at: new Date().toISOString(),
    }),
    ...overrides,
  }
}

describe("ShippingProviderRouter", () => {
  it("retries quote on transient 5xx failure", async () => {
    const quote = jest
      .fn()
      .mockRejectedValueOnce({ status: 500, message: "upstream 500" })
      .mockResolvedValue({ quotes: [] })
    const provider = makeProvider({ quote })
    const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }

    const router = new ShippingProviderRouter({
      providers: { fake: provider },
      env: {
        SHIPPING_PROVIDER_DEFAULT: "fake",
      } as any,
      scopeOrLogger: logger,
      sleep: async () => {},
      random: () => 0,
    })

    const result = await router.quote({
      request: makeQuoteRequest(),
      correlation_id: "corr_quote_retry_1",
    })

    expect(result.quotes).toEqual([])
    expect(quote).toHaveBeenCalledTimes(2)

    const serialized = logger.info.mock.calls[0]?.[0]
    const parsed = JSON.parse(serialized)
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(0)
    expect(parsed.message).toBe("SHIPPING_PROVIDER_CALL")
    expect(parsed.correlation_id).toBe("corr_quote_retry_1")
    expect(parsed.meta.provider).toBe("fake")
    expect(parsed.meta.method).toBe("quote")
    expect(typeof parsed.meta.duration_ms).toBe("number")
    expect(parsed.meta.success).toBe(true)
  })

  it("routes track(shipment_id) using stored shipment provider and retries on 429", async () => {
    const providerA = makeProvider({ provider: "a", track: jest.fn() as any })
    const trackB = jest
      .fn()
      .mockRejectedValueOnce({ status: 429, message: "rate limited" })
      .mockResolvedValue({
        shipment_id: "provider_shp_b_1",
        status: ShipmentStatus.IN_TRANSIT,
        events: [],
      })
    const providerB = makeProvider({ provider: "b", track: trackB as any })

    const shipmentRepository = {
      getShipmentById: jest.fn().mockResolvedValue({
        id: "ship_internal_1",
        provider: "b",
        provider_shipment_id: "provider_shp_b_1",
        provider_awb: "awb_b_1",
        internal_reference: "order_1:b:1",
      }),
    }

    const router = new ShippingProviderRouter({
      providers: {
        a: providerA,
        b: providerB,
      },
      shipment_repository: shipmentRepository as any,
      sleep: async () => {},
      random: () => 0,
    })

    const tracked = await router.track({
      shipment_id: "ship_internal_1",
      correlation_id: "corr_track_route_1",
    })

    expect(tracked.shipment_id).toBe("provider_shp_b_1")
    expect(shipmentRepository.getShipmentById).toHaveBeenCalledWith("ship_internal_1")
    expect(trackB).toHaveBeenCalledTimes(2)
    expect((providerA.track as jest.Mock)).not.toHaveBeenCalled()
  })

  it("uses internal_reference fallback for track when provider IDs are missing", async () => {
    const trackB = jest.fn().mockResolvedValue({
      shipment_id: "provider_shp_b_2",
      status: ShipmentStatus.IN_TRANSIT,
      events: [],
    })
    const providerB = makeProvider({ provider: "b", track: trackB as any })
    const shipmentRepository = {
      getShipmentById: jest.fn().mockResolvedValue({
        id: "ship_internal_ref_only_1",
        provider: "b",
        provider_shipment_id: null,
        provider_awb: null,
        internal_reference: "order_2:b:refonly",
      }),
    }

    const router = new ShippingProviderRouter({
      providers: { b: providerB },
      shipment_repository: shipmentRepository as any,
    })

    const tracked = await router.track({
      shipment_id: "ship_internal_ref_only_1",
      correlation_id: "corr_track_ref_fallback_1",
    })

    expect(tracked.status).toBe(ShipmentStatus.IN_TRANSIT)
    expect(trackB).toHaveBeenCalledTimes(1)
    expect(trackB).toHaveBeenCalledWith(
      expect.objectContaining({
        internal_reference: "order_2:b:refonly",
      })
    )
  })

  it("uses new default provider for new bookings while old shipments stay routed by stored provider", async () => {
    const trackA = jest.fn().mockResolvedValue({
      shipment_id: "provider_shp_a_1",
      status: ShipmentStatus.IN_TRANSIT,
      events: [],
    })
    const cancelA = jest.fn().mockResolvedValue({
      shipment_id: "provider_shp_a_1",
      cancelled: true,
      status: ShipmentStatus.CANCELLED,
    })
    const providerA = makeProvider({
      provider: "a",
      track: trackA as any,
      cancel: cancelA as any,
    })
    const createShipmentB = jest.fn().mockResolvedValue({
      shipment_id: "provider_shp_b_new_1",
      status: ShipmentStatus.BOOKED,
    })
    const providerB = makeProvider({
      provider: "b",
      createShipment: createShipmentB as any,
      track: jest.fn() as any,
      cancel: jest.fn() as any,
    })

    const shipmentRepository = {
      getShipmentById: jest.fn().mockResolvedValue({
        id: "ship_legacy_1",
        provider: "a",
        provider_shipment_id: "provider_shp_a_1",
        provider_awb: "awb_a_1",
      }),
    }

    const router = new ShippingProviderRouter({
      providers: {
        a: providerA,
        b: providerB,
      },
      env: {
        SHIPPING_PROVIDER_DEFAULT: "b",
      } as any,
      shipment_repository: shipmentRepository as any,
      sleep: async () => {},
      random: () => 0,
    })

    await router.createShipment({
      request: makeCreateShipmentRequest(),
      correlation_id: "corr_default_switch_create_1",
    })

    const tracked = await router.track({
      shipment_id: "ship_legacy_1",
      correlation_id: "corr_default_switch_track_1",
    })

    const cancelled = await router.cancel({
      request: {
        shipment_id: "ship_legacy_1",
      },
      correlation_id: "corr_default_switch_cancel_1",
    })

    expect(createShipmentB).toHaveBeenCalledTimes(1)
    expect((providerA.createShipment as jest.Mock)).not.toHaveBeenCalled()
    expect(tracked.shipment_id).toBe("provider_shp_a_1")
    expect(trackA).toHaveBeenCalledTimes(1)
    expect((providerB.track as jest.Mock)).not.toHaveBeenCalled()
    expect(cancelled.cancelled).toBe(true)
    expect(cancelA).toHaveBeenCalledTimes(1)
    expect(cancelA).toHaveBeenCalledWith(
      expect.objectContaining({
        shipment_id: "provider_shp_a_1",
      })
    )
    expect((providerB.cancel as jest.Mock)).not.toHaveBeenCalled()
  })

  it("treats already-cancelled internal shipment as idempotent success", async () => {
    const cancelA = jest.fn()
    const providerA = makeProvider({
      provider: "a",
      cancel: cancelA as any,
    })
    const shipmentRepository = {
      getShipmentById: jest.fn().mockResolvedValue({
        id: "ship_already_cancelled_1",
        provider: "a",
        provider_shipment_id: "provider_shp_a_cancelled_1",
        provider_awb: "awb_a_cancelled_1",
        internal_reference: "order_cancelled_1:a:1",
        status: ShipmentStatus.CANCELLED,
      }),
      updateShipmentStatusMonotonic: jest.fn(),
    }

    const router = new ShippingProviderRouter({
      providers: {
        a: providerA,
      },
      shipment_repository: shipmentRepository as any,
    })

    const result = await router.cancelByShipment({
      shipment_id: "ship_already_cancelled_1",
      correlation_id: "corr_cancel_idempotent_1",
    })

    expect(result).toEqual({
      shipment_id: "ship_already_cancelled_1",
      cancelled: true,
      status: ShipmentStatus.CANCELLED,
    })
    expect(cancelA).not.toHaveBeenCalled()
    expect(shipmentRepository.updateShipmentStatusMonotonic).not.toHaveBeenCalled()
  })

  it("blocks cancel when internal shipment is already in transit/delivered", async () => {
    const cancelA = jest.fn()
    const providerA = makeProvider({
      provider: "a",
      cancel: cancelA as any,
    })
    const shipmentRepository = {
      getShipmentById: jest.fn().mockResolvedValue({
        id: "ship_in_transit_1",
        provider: "a",
        provider_shipment_id: "provider_shp_a_in_transit_1",
        provider_awb: "awb_a_in_transit_1",
        internal_reference: "order_in_transit_1:a:1",
        status: ShipmentStatus.IN_TRANSIT,
      }),
      updateShipmentStatusMonotonic: jest.fn(),
    }

    const router = new ShippingProviderRouter({
      providers: {
        a: providerA,
      },
      shipment_repository: shipmentRepository as any,
    })

    await expect(
      router.cancelByShipment({
        shipment_id: "ship_in_transit_1",
        correlation_id: "corr_cancel_blocked_1",
      })
    ).rejects.toMatchObject({
      code: "CANNOT_CANCEL_IN_STATE",
    })

    expect(cancelA).not.toHaveBeenCalled()
    expect(shipmentRepository.updateShipmentStatusMonotonic).not.toHaveBeenCalled()
  })

  it("cancelling twice is idempotent and only updates state once", async () => {
    const cancelA = jest.fn().mockResolvedValue({
      shipment_id: "provider_shp_a_2",
      cancelled: true,
      status: ShipmentStatus.CANCELLED,
    })
    const providerA = makeProvider({
      provider: "a",
      cancel: cancelA as any,
    })
    const shipmentRepository = {
      getShipmentById: jest
        .fn()
        .mockResolvedValueOnce({
          id: "ship_cancel_twice_1",
          provider: "a",
          provider_shipment_id: "provider_shp_a_2",
          provider_awb: "awb_a_2",
          internal_reference: "order_cancel_twice_1:a:1",
          status: ShipmentStatus.BOOKED,
        })
        .mockResolvedValueOnce({
          id: "ship_cancel_twice_1",
          provider: "a",
          provider_shipment_id: "provider_shp_a_2",
          provider_awb: "awb_a_2",
          internal_reference: "order_cancel_twice_1:a:1",
          status: ShipmentStatus.CANCELLED,
        }),
      updateShipmentStatusMonotonic: jest.fn().mockResolvedValue({
        updated: true,
        shipment: {
          id: "ship_cancel_twice_1",
          status: ShipmentStatus.CANCELLED,
        },
      }),
    }

    const router = new ShippingProviderRouter({
      providers: {
        a: providerA,
      },
      shipment_repository: shipmentRepository as any,
    })

    const first = await router.cancelByShipment({
      shipment_id: "ship_cancel_twice_1",
      correlation_id: "corr_cancel_twice_1",
    })
    const second = await router.cancelByShipment({
      shipment_id: "ship_cancel_twice_1",
      correlation_id: "corr_cancel_twice_2",
    })

    expect(first.cancelled).toBe(true)
    expect(second).toEqual({
      shipment_id: "ship_cancel_twice_1",
      cancelled: true,
      status: ShipmentStatus.CANCELLED,
    })
    expect(cancelA).toHaveBeenCalledTimes(1)
    expect(shipmentRepository.updateShipmentStatusMonotonic).toHaveBeenCalledTimes(1)
    expect(shipmentRepository.updateShipmentStatusMonotonic).toHaveBeenCalledWith({
      shipment_id: "ship_cancel_twice_1",
      next_status: ShipmentStatus.CANCELLED,
    })
  })

  it("does not retry createShipment by default", async () => {
    const createShipment = jest
      .fn()
      .mockRejectedValue({ status: 500, message: "booking failure" })
    const provider = makeProvider({
      createShipment,
      capabilities: {
        supports_cod: true,
        supports_reverse: true,
        supports_label_regen: true,
        supports_webhooks: true,
        supports_cancel: true,
        supports_multi_piece: true,
        supports_idempotency: false,
        supports_reference_lookup: true,
      },
    })

    const router = new ShippingProviderRouter({
      providers: { fake: provider },
      env: {
        SHIPPING_PROVIDER_DEFAULT: "fake",
      } as any,
      sleep: async () => {},
      random: () => 0,
    })

    await expect(
      router.createShipment({
        request: makeCreateShipmentRequest(),
        correlation_id: "corr_create_no_retry_1",
      })
    ).rejects.toBeInstanceOf(ShippingProviderError)

    expect(createShipment).toHaveBeenCalledTimes(1)
  })

  it("opens circuit breaker and fails fast after threshold", async () => {
    const quote = jest.fn().mockRejectedValue({
      status: 500,
      message: "upstream down",
    })
    const provider = makeProvider({ quote })

    const router = new ShippingProviderRouter({
      providers: { fake: provider },
      env: {
        SHIPPING_PROVIDER_DEFAULT: "fake",
      } as any,
      retry: {
        max_attempts: 1,
      },
      circuit_breaker: {
        consecutive_failures_threshold: 2,
        error_rate_threshold_percent: 100,
        rolling_window_size: 20,
        open_duration_ms: 120_000,
      },
      sleep: async () => {},
      random: () => 0,
      now: () => 1_000_000,
    })

    await expect(
      router.quote({
        request: makeQuoteRequest(),
        correlation_id: "corr_cb_1",
      })
    ).rejects.toBeInstanceOf(ShippingProviderError)

    await expect(
      router.quote({
        request: makeQuoteRequest(),
        correlation_id: "corr_cb_2",
      })
    ).rejects.toBeInstanceOf(ShippingProviderError)

    await expect(
      router.quote({
        request: makeQuoteRequest(),
        correlation_id: "corr_cb_3",
      })
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    })

    expect(quote).toHaveBeenCalledTimes(2)
  })

  it("blocks createShipment when SHIPPING_BOOKING_ENABLED=false", async () => {
    const createShipment = jest.fn()
    const provider = makeProvider({ createShipment })
    const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }

    const router = new ShippingProviderRouter({
      providers: { fake: provider },
      env: {
        SHIPPING_PROVIDER_DEFAULT: "fake",
        SHIPPING_BOOKING_ENABLED: "false",
      } as any,
      scopeOrLogger: logger,
    })

    await expect(
      router.createShipment({
        request: makeCreateShipmentRequest(),
        correlation_id: "corr_booking_disabled_1",
      })
    ).rejects.toMatchObject({
      code: "BOOKING_DISABLED",
    })

    expect(createShipment).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(logger.error.mock.calls[0]?.[0] as string)
    expect(payload.message).toBe("SHIPPING_PROVIDER_CALL")
    expect(payload.meta.error_code).toBe("BOOKING_DISABLED")
  })
})
