import { PaymentProviderError } from "../contracts"
import { PaymentProviderRouter } from "../provider-router"

const CORRELATION_ID = "d39ab0df-d2f0-4db9-b143-4df03b7e9d56"

describe("PaymentProviderRouter", () => {
  const providers = {
    razorpay: {
      id: "razorpay_provider",
    },
    cod: {
      id: "cod_provider",
    },
  }

  it("returns default provider from env and logs selection event", () => {
    const logger = {
      info: jest.fn(),
    }

    const router = new PaymentProviderRouter({
      providers,
      env: {
        PAYMENT_PROVIDER_DEFAULT: "razorpay",
        PAYMENTS_ENABLED: "true",
      },
      scopeOrLogger: logger,
    })

    const selected = router.getDefaultProvider({
      correlation_id: CORRELATION_ID,
      payment_session_id: "ps_default_1",
    })

    expect(selected.provider_id).toBe("razorpay")
    expect(selected.provider).toBe(providers.razorpay)
    expect(selected.correlation_id).toBe(CORRELATION_ID)

    expect(logger.info).toHaveBeenCalledTimes(1)
    const serialized = logger.info.mock.calls[0]?.[0]
    const parsed = JSON.parse(serialized)

    expect(parsed.message).toBe("PAYMENT_PROVIDER_SELECTED")
    expect(parsed.correlation_id).toBe(CORRELATION_ID)
    expect(parsed.meta.provider).toBe("razorpay")
    expect(parsed.meta.payment_session_id).toBe("ps_default_1")
  })

  it("falls back to cod when PAYMENT_PROVIDER_DEFAULT is not set", () => {
    const router = new PaymentProviderRouter({
      providers,
      env: {
        PAYMENTS_ENABLED: "true",
      },
    })

    const selected = router.getDefaultProvider({
      correlation_id: CORRELATION_ID,
    })

    expect(selected.provider_id).toBe("cod")
    expect(selected.provider).toBe(providers.cod)
  })

  it("routes existing payment session by stored provider_id even when default differs", async () => {
    const query = {
      graph: jest.fn().mockResolvedValue({
        data: [
          {
            id: "ps_existing_1",
            provider_id: "pp_razorpay_razorpay",
          },
        ],
      }),
    }

    const router = new PaymentProviderRouter({
      providers,
      env: {
        PAYMENT_PROVIDER_DEFAULT: "cod",
        PAYMENTS_ENABLED: "true",
      },
      query,
    })

    const selected = await router.getProviderForPaymentSession({
      payment_session_id: "ps_existing_1",
      correlation_id: CORRELATION_ID,
    })

    expect(query.graph).toHaveBeenCalledWith({
      entity: "payment_session",
      fields: ["id", "provider_id"],
      filters: {
        id: "ps_existing_1",
      },
    })
    expect(selected.provider_id).toBe("razorpay")
    expect(selected.provider).toBe(providers.razorpay)
  })

  it("fails fast when PAYMENTS_ENABLED=false", () => {
    const router = new PaymentProviderRouter({
      providers,
      env: {
        PAYMENT_PROVIDER_DEFAULT: "razorpay",
        PAYMENTS_ENABLED: "false",
      },
    })

    expect.assertions(4)

    try {
      router.getDefaultProvider({
        correlation_id: CORRELATION_ID,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentProviderError)
      expect((error as PaymentProviderError).code).toBe("PROVIDER_UNAVAILABLE")
      expect((error as PaymentProviderError).http_status).toBe(503)
      expect((error as PaymentProviderError).correlation_id).toBe(CORRELATION_ID)
    }
  })
})
