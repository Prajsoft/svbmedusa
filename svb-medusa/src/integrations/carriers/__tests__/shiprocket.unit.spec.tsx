import crypto from "crypto"
import {
  mapShiprocketErrorCode,
  mapShiprocketStatus,
  ShiprocketProvider,
} from "../shiprocket"
import {
  ShipmentStatus,
  ShippingProviderError,
  type CreateShipmentRequest,
  type QuoteRequest,
} from "../provider-contract"

type FetchResponseLike = {
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function makeResponse(status: number, body: unknown): FetchResponseLike {
  return {
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

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
    cod: {
      enabled: true,
      amount: 1299,
    },
  }
}

function makeCreateRequest(): CreateShipmentRequest {
  return {
    internal_reference: "order_1:shiprocket:1",
    idempotency_key: "order_1:shiprocket:1",
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
        unit_price: 1299,
      },
    ],
    cod: {
      enabled: false,
      amount: 0,
    },
    metadata: {
      pickup_location_code: "WH-MRT-01",
    },
  }
}

function makeCourierOption(overrides: Record<string, unknown> = {}) {
  return {
    courier_company_id: 99,
    courier_name: "Shiprocket Air",
    freight_charge: 89,
    cod: true,
    etd: 2,
    ...overrides,
  }
}

describe("ShiprocketProvider HTTP behavior", () => {
  it("uses SHIPROCKET_BASE_URL and seller credential aliases without duplicating /v1/external", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            token: "token_alias_1",
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_BASE_URL: "https://api.shiprocket.test/v1/external",
        SHIPROCKET_SELLER_EMAIL: "seller@example.com",
        SHIPROCKET_SELLER_PASSWORD: "seller-secret",
      } as any,
    })

    await provider.quote(makeQuoteRequest())

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.shiprocket.test/v1/external/auth/login"
    )
    expect(fetchMock.mock.calls[0][1].body).toContain("seller@example.com")
    expect(fetchMock.mock.calls[0][1].body).toContain("seller-secret")
    expect(fetchMock.mock.calls[1][0]).toContain(
      "https://api.shiprocket.test/v1/external/courier/serviceability/"
    )
    expect(fetchMock.mock.calls[2][0]).toContain(
      "https://api.shiprocket.test/v1/external/courier/serviceability/"
    )
  })

  it("refreshes auth token based on TTL and refresh skew env config", async () => {
    let nowMs = new Date("2026-02-21T00:00:00.000Z").getTime()
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            token: "token_ttl_1",
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            token: "token_ttl_2",
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      now: () => new Date(nowMs),
      env: {
        SHIPROCKET_BASE_URL: "https://api.shiprocket.test/v1/external",
        SHIPROCKET_SELLER_EMAIL: "seller@example.com",
        SHIPROCKET_SELLER_PASSWORD: "seller-secret",
        SHIPROCKET_TOKEN_TTL_HOURS: "1",
        SHIPROCKET_TOKEN_REFRESH_SKEW_MINUTES: "10",
      } as any,
    })

    await provider.quote(makeQuoteRequest())
    nowMs += 20 * 60 * 1000
    await provider.quote(makeQuoteRequest())
    nowMs += 31 * 60 * 1000
    await provider.quote(makeQuoteRequest())

    const authCalls = fetchMock.mock.calls.filter((call) =>
      String(call?.[0]).includes("/auth/login")
    )
    expect(authCalls).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })

  it("uses single-flight auth refresh across concurrent callers", async () => {
    let resolveLogin: ((value: FetchResponseLike) => void) | null = null
    const loginPromise = new Promise<FetchResponseLike>((resolve) => {
      resolveLogin = resolve
    })

    const fetchMock = jest.fn((url: string) => {
      if (url.includes("/auth/login")) {
        return loginPromise
      }

      return Promise.resolve(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
    })

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_BASE_URL: "https://api.shiprocket.test/v1/external",
        SHIPROCKET_SELLER_EMAIL: "seller@example.com",
        SHIPROCKET_SELLER_PASSWORD: "seller-secret",
      } as any,
    })

    const first = provider.quote(makeQuoteRequest())
    const second = provider.quote(makeQuoteRequest())

    await Promise.resolve()
    const authCallsBeforeResolve = fetchMock.mock.calls.filter((call) =>
      String(call?.[0]).includes("/auth/login")
    )
    expect(authCallsBeforeResolve).toHaveLength(1)

    resolveLogin?.(
      makeResponse(200, {
        data: {
          token: "token_single_flight_1",
        },
      })
    )

    await Promise.all([first, second])

    const authCalls = fetchMock.mock.calls.filter((call) =>
      String(call?.[0]).includes("/auth/login")
    )
    expect(authCalls).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it("refreshes token and retries once when request gets 401", async () => {
    let loginCount = 0
    const fetchMock = jest.fn((url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes("/auth/login")) {
        loginCount += 1
        return Promise.resolve(
          makeResponse(200, {
            data: {
              token: `token_retry_${loginCount}`,
            },
          })
        )
      }

      if (url.includes("/courier/serviceability/")) {
        const auth = init?.headers?.authorization
        if (auth === "Bearer token_retry_1") {
          return Promise.resolve(
            makeResponse(401, {
              message: "Unauthorized",
            })
          )
        }

        if (auth === "Bearer token_retry_2") {
          return Promise.resolve(
            makeResponse(200, {
              data: {
                available_courier_companies: [makeCourierOption()],
              },
            })
          )
        }
      }

      if (url.includes("/courier/rate-calculator")) {
        return Promise.resolve(
          makeResponse(200, {
            data: {
              rates: [makeCourierOption()],
            },
          })
        )
      }

      return Promise.resolve(
        makeResponse(500, {
          message: "unexpected",
        })
      )
    })

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_BASE_URL: "https://api.shiprocket.test/v1/external",
        SHIPROCKET_SELLER_EMAIL: "seller@example.com",
        SHIPROCKET_SELLER_PASSWORD: "seller-secret",
      } as any,
    })

    const result = await provider.quote(makeQuoteRequest())

    expect(result.quotes).toHaveLength(1)
    expect(loginCount).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it("retries retryable requests on 429/5xx with backoff", async () => {
    const sleepMock = jest.fn(async () => undefined)
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(429, {
          message: "rate limited",
        })
      )
      .mockResolvedValueOnce(
        makeResponse(503, {
          message: "upstream unavailable",
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            rates: [makeCourierOption()],
          },
        })
      )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      sleep: sleepMock,
      random: () => 0,
      env: {
        SHIPROCKET_TOKEN: "token_1",
        SHIPROCKET_RETRY_MAX_ATTEMPTS: "3",
      } as any,
    })

    const result = await provider.quote(makeQuoteRequest())

    expect(result.quotes).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(sleepMock).toHaveBeenCalledTimes(2)
  })

  it("does not retry non-retryable createShipment on 5xx", async () => {
    const sleepMock = jest.fn(async () => undefined)
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(503, {
        message: "upstream unavailable",
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      sleep: sleepMock,
      random: () => 0,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    await expect(provider.createShipment(makeCreateRequest())).rejects.toMatchObject<
      ShippingProviderError
    >({
      code: "PROVIDER_UNAVAILABLE",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).toHaveBeenCalledTimes(0)
  })

  it("emits provider observability logs for auth and request calls", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined)

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            token: "token_observe_1",
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            rates: [makeCourierOption()],
          },
        })
      )

    try {
      const provider = new ShiprocketProvider({
        fetch: fetchMock as any,
        env: {
          SHIPROCKET_BASE_URL: "https://api.shiprocket.test/v1/external",
          SHIPROCKET_SELLER_EMAIL: "seller@example.com",
          SHIPROCKET_SELLER_PASSWORD: "seller-secret",
        } as any,
      })

      await provider.quote({
        ...makeQuoteRequest(),
        correlation_id: "corr_shiprocket_observe_1",
      })

      const payloads = logSpy.mock.calls
        .map((call) => {
          const line = call[0]
          if (typeof line !== "string") {
            return null
          }
          try {
            return JSON.parse(line) as Record<string, any>
          } catch {
            return null
          }
        })
        .filter((entry): entry is Record<string, any> => Boolean(entry))
        .filter((entry) => entry.message === "SHIPPING_PROVIDER_CALL")
      const methods = payloads.map((entry) => entry.meta?.method)
      expect(methods).toContain("auth/login")
      expect(methods).toContain("request/serviceability")
      expect(methods).toContain("request/rate-calculator")

      for (const payload of payloads) {
        expect(payload).toEqual(
          expect.objectContaining({
            message: "SHIPPING_PROVIDER_CALL",
            correlation_id: "corr_shiprocket_observe_1",
            meta: expect.objectContaining({
              provider: "shiprocket",
              duration_ms: expect.any(Number),
              success: expect.any(Boolean),
            }),
          })
        )
      }
    } finally {
      logSpy.mockRestore()
    }
  })

  it("maps quote response to normalized quote DTO", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            rates: [makeCourierOption()],
          },
        })
      )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
        SHIPROCKET_API_BASE_URL: "https://api.shiprocket.test",
      } as any,
    })

    const result = await provider.quote(makeQuoteRequest())

    expect(result.quotes).toHaveLength(1)
    expect(result.quotes[0]).toMatchObject({
      service_code: "99",
      service_name: "Shiprocket Air",
      price: 89,
      currency_code: "INR",
      cod_supported: true,
      eta_days: 2,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/v1/external/courier/serviceability/"
    )
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      "Bearer token_1"
    )
    expect(fetchMock.mock.calls[1][0]).toContain(
      "/v1/external/courier/serviceability/"
    )
  })

  it("returns SERVICEABILITY_FAILED when serviceability has no courier options", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(200, {
        data: {
          available_courier_companies: [],
        },
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    await expect(provider.quote(makeQuoteRequest())).rejects.toMatchObject<
      ShippingProviderError
    >({
      code: "SERVICEABILITY_FAILED",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns UPSTREAM_ERROR when serviceability passes but rate calculator fails", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            available_courier_companies: [makeCourierOption()],
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(503, {
          message: "rate upstream down",
        })
      )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
        SHIPROCKET_RATE_CALCULATOR_PATH: "/v1/external/courier/rate-calculator",
        SHIPROCKET_RETRY_MAX_ATTEMPTS: "1",
      } as any,
    })

    await expect(provider.quote(makeQuoteRequest())).rejects.toMatchObject<
      ShippingProviderError
    >({
      code: "UPSTREAM_ERROR",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("maps createShipment response to normalized shipment DTO", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(200, {
        data: {
          order_id: "order_1:shiprocket:1",
          shipment_id: "shipment_1",
          awb_code: "AWB_1",
          status: "NEW",
          label_url: "https://labels.test/1.pdf",
        },
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    const result = await provider.createShipment(makeCreateRequest())

    expect(result).toMatchObject({
      shipment_id: "shipment_1",
      tracking_number: "AWB_1",
      status: ShipmentStatus.BOOKED,
      metadata: {
        provider_order_id: "order_1:shiprocket:1",
      },
    })
    expect(result.tracking_url).toContain("AWB_1")
    expect(result.label?.label_url).toBe("https://labels.test/1.pdf")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/external/shipments/create/forward-shipment"
    )
  })

  it("fails createShipment when booking kill-switch is disabled without outbound call", async () => {
    const fetchMock = jest.fn()
    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
        SHIPPING_BOOKING_ENABLED: "false",
      } as any,
    })

    await expect(provider.createShipment(makeCreateRequest())).rejects.toMatchObject<
      ShippingProviderError
    >({
      code: "BOOKING_DISABLED",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("finds shipment by internal reference for recovery and normalizes response", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(200, {
        data: {
          order_id: "order_1:shiprocket:1",
          shipment_id: "shipment_lookup_1",
          awb_code: "AWB_LOOKUP_1",
          status: "In Transit",
          label_url: "https://labels.test/lookup.pdf",
        },
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    const result = await provider.findShipmentByReference?.({
      internal_reference: "order_1:shiprocket:1",
      correlation_id: "corr_lookup_1",
    })

    expect(result).toMatchObject({
      shipment_id: "shipment_lookup_1",
      tracking_number: "AWB_LOOKUP_1",
      status: ShipmentStatus.IN_TRANSIT,
      metadata: {
        provider_order_id: "order_1:shiprocket:1",
      },
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/external/orders/show/order_1%3Ashiprocket%3A1"
    )
  })

  it("returns null when lookup by reference is not found", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(404, {
        message: "Order not found",
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    const result = await provider.findShipmentByReference?.({
      internal_reference: "missing-ref",
    })

    expect(result).toBeNull()
  })

  it("regenerates label when first response has no label url", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {},
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            label_url: "https://labels.test/2.pdf",
          },
        })
      )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
      now: () => new Date("2026-02-21T00:00:00.000Z"),
    })

    const label = await provider.getLabel({
      shipment_id: "shipment_2",
      regenerate_if_expired: true,
    })

    expect(label.label_url).toBe("https://labels.test/2.pdf")
    expect(label.regenerated).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("maps tracking response and status history", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(200, {
        tracking_data: {
          awb_code: "AWB_3",
          shipment_status: "Out For Delivery",
          shipment_track: [
            {
              current_status: "Out For Delivery",
              date: "2026-02-21T00:00:00.000Z",
              location: "Chennai",
              message: "Reached local hub",
            },
          ],
        },
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    const tracked = await provider.track({
      tracking_number: "AWB_3",
    })

    expect(tracked.status).toBe(ShipmentStatus.OFD)
    expect(tracked.events).toHaveLength(1)
    expect(tracked.events[0].status).toBe(ShipmentStatus.OFD)
    expect(tracked.events[0].location).toBe("Chennai")
  })

  it("maps AWB tracking 404 to SHIPMENT_NOT_FOUND", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(404, {
        message: "Shipment not found",
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    await expect(
      provider.track({
        tracking_number: "AWB_MISSING",
      })
    ).rejects.toMatchObject<ShippingProviderError>({
      code: "SHIPMENT_NOT_FOUND",
    })
  })

  it("uses AWB tracking endpoint when both tracking_number and shipment_id are provided", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(200, {
        tracking_data: {
          awb_code: "AWB_PRIORITY",
          shipment_status: "In Transit",
          shipment_track: [],
        },
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    await provider.track({
      tracking_number: "AWB_PRIORITY",
      shipment_id: "shipment_priority",
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/external/courier/track/awb/AWB_PRIORITY"
    )
  })

  it("falls back to internal_reference lookup when AWB and shipment id are absent", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse(200, {
          data: {
            order_id: "order_internal_ref_1",
            shipment_id: "shipment_from_lookup",
            awb_code: "AWB_FROM_LOOKUP",
            status: "NEW",
          },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          tracking_data: {
            awb_code: "AWB_FROM_LOOKUP",
            shipment_status: "Out For Delivery",
            shipment_track: [],
          },
        })
      )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    const tracked = await provider.track({
      internal_reference: "order_internal_ref_1",
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/external/orders/show/order_internal_ref_1"
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/v1/external/courier/track/awb/AWB_FROM_LOOKUP"
    )
    expect(tracked.status).toBe(ShipmentStatus.OFD)
  })

  it("maps cancel response to normalized cancel DTO", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(200, {
        message: "Order cancelled successfully",
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
      now: () => new Date("2026-02-21T00:00:00.000Z"),
    })

    const cancelled = await provider.cancel({
      shipment_id: "shipment_4",
    })

    expect(cancelled).toMatchObject({
      shipment_id: "shipment_4",
      cancelled: true,
      status: ShipmentStatus.CANCELLED,
      cancelled_at: "2026-02-21T00:00:00.000Z",
    })
  })

  it("treats provider 'already cancelled' response as idempotent success", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(400, {
        message: "Order is already cancelled",
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
      now: () => new Date("2026-02-21T00:00:00.000Z"),
    })

    const cancelled = await provider.cancel({
      shipment_id: "shipment_5",
    })

    expect(cancelled).toMatchObject({
      shipment_id: "shipment_5",
      cancelled: true,
      status: ShipmentStatus.CANCELLED,
      cancelled_at: "2026-02-21T00:00:00.000Z",
    })
  })

  it("maps provider not-cancellable response to CANNOT_CANCEL_IN_STATE", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(400, {
        message: "Order cannot be cancelled as it has been shipped",
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    await expect(
      provider.cancel({
        shipment_id: "shipment_6",
      })
    ).rejects.toMatchObject<ShippingProviderError>({
      code: "CANNOT_CANCEL_IN_STATE",
    })
  })

  it("returns healthy response when Shiprocket is reachable", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(200, {
        data: {
          available_courier_companies: [],
        },
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
      now: () => new Date("2026-02-21T00:00:00.000Z"),
    })

    const health = await provider.healthCheck()

    expect(health).toEqual({
      ok: true,
      provider: "shiprocket",
      checked_at: "2026-02-21T00:00:00.000Z",
    })
  })

  it("maps upstream auth failures to AUTH_FAILED", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse(401, {
        message: "Unauthorized",
      })
    )

    const provider = new ShiprocketProvider({
      fetch: fetchMock as any,
      env: {
        SHIPROCKET_TOKEN: "token_1",
      } as any,
    })

    await expect(provider.quote(makeQuoteRequest())).rejects.toMatchObject<
      ShippingProviderError
    >({
      code: "AUTH_FAILED",
    })
  })
})

describe("ShiprocketProvider mappings", () => {
  it("maps Shiprocket statuses to normalized shipment statuses", () => {
    expect(mapShiprocketStatus("NEW")).toBe(ShipmentStatus.BOOKED)
    expect(mapShiprocketStatus("Pickup Scheduled")).toBe(
      ShipmentStatus.PICKUP_SCHEDULED
    )
    expect(mapShiprocketStatus("In Transit")).toBe(ShipmentStatus.IN_TRANSIT)
    expect(mapShiprocketStatus("Out For Delivery")).toBe(ShipmentStatus.OFD)
    expect(mapShiprocketStatus("Delivered")).toBe(ShipmentStatus.DELIVERED)
    expect(mapShiprocketStatus("RTO In Transit")).toBe(
      ShipmentStatus.RTO_IN_TRANSIT
    )
    expect(mapShiprocketStatus("RTO Delivered")).toBe(
      ShipmentStatus.RTO_DELIVERED
    )
    expect(mapShiprocketStatus("Cancelled")).toBe(ShipmentStatus.CANCELLED)
  })

  it("maps Shiprocket error responses to normalized provider error codes", () => {
    expect(mapShiprocketErrorCode({ status: 401, message: "unauthorized" })).toBe(
      "AUTH_FAILED"
    )
    expect(mapShiprocketErrorCode({ status: 429, message: "rate limited" })).toBe(
      "RATE_LIMITED"
    )
    expect(mapShiprocketErrorCode({ status: 404, message: "not found" })).toBe(
      "SHIPMENT_NOT_FOUND"
    )
    expect(
      mapShiprocketErrorCode({
        status: 400,
        message: "delivery pincode is not serviceable",
      })
    ).toBe("SERVICEABILITY_FAILED")
    expect(
      mapShiprocketErrorCode({
        status: 400,
        message: "invalid address supplied",
      })
    ).toBe("INVALID_ADDRESS")
    expect(
      mapShiprocketErrorCode({
        status: 400,
        message: "shipment cannot be cancelled because it is already shipped",
      })
    ).toBe("CANNOT_CANCEL_IN_STATE")
    expect(mapShiprocketErrorCode({ status: 503, message: "upstream down" })).toBe(
      "PROVIDER_UNAVAILABLE"
    )
    expect(mapShiprocketErrorCode({ status: 400, message: "other error" })).toBe(
      "UPSTREAM_ERROR"
    )
  })
})

describe("ShiprocketProvider webhook verification", () => {
  it("verifies webhook signature using configured secret", () => {
    const provider = new ShiprocketProvider({
      env: {
        SHIPROCKET_WEBHOOK_SECRET: "whsec_shiprocket_test",
      } as any,
    })
    const rawBody = JSON.stringify({
      event: "in_transit",
      shipment_id: "sr_ship_1",
    })
    const signature = crypto
      .createHmac("sha256", "whsec_shiprocket_test")
      .update(rawBody)
      .digest("hex")

    const verified = provider.verifyWebhook({
      headers: {
        "x-shiprocket-signature": signature,
      },
      raw_body: rawBody,
    })

    expect(verified).toBe(true)
  })

  it("rejects webhook when signature is missing or invalid", () => {
    const provider = new ShiprocketProvider({
      env: {
        SHIPROCKET_WEBHOOK_SECRET: "whsec_shiprocket_test",
      } as any,
    })
    const rawBody = JSON.stringify({
      event: "delivered",
      shipment_id: "sr_ship_2",
    })

    expect(
      provider.verifyWebhook({
        headers: {},
        raw_body: rawBody,
      })
    ).toBe(false)

    expect(
      provider.verifyWebhook({
        headers: {
          "x-shiprocket-signature": "invalid",
        },
        raw_body: rawBody,
      })
    ).toBe(false)
  })

  it("rejects webhook when source IP is outside allowlist", () => {
    const provider = new ShiprocketProvider({
      env: {
        SHIPROCKET_WEBHOOK_SECRET: "whsec_shiprocket_test",
        SHIPROCKET_WEBHOOK_IP_ALLOWLIST: "10.0.0.1",
      } as any,
    })
    const rawBody = JSON.stringify({
      event: "in_transit",
      shipment_id: "sr_ship_3",
    })
    const signature = crypto
      .createHmac("sha256", "whsec_shiprocket_test")
      .update(rawBody)
      .digest("hex")

    const verified = provider.verifyWebhook({
      headers: {
        "x-shiprocket-signature": signature,
        "x-forwarded-for": "203.0.113.25",
      },
      raw_body: rawBody,
    })

    expect(verified).toBe(false)
  })
})
