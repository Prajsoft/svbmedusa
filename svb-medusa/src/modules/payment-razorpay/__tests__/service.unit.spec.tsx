import crypto from "crypto"
import {
  ContainerRegistrationKeys,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import RazorpayPaymentProviderService from "../service"
import * as razorpayClientModule from "../client"
import {
  __resetMetricsForTests,
  getMetricsSnapshot,
} from "../../observability/metrics"

jest.mock("../client", () => {
  const actual = jest.requireActual("../client")
  return {
    ...actual,
    getRazorpayClient: jest.fn(),
  }
})

type PgMockState = {
  sessionOrders: Map<
    string,
    {
      orderId: string
      amount: number
      currency: string
      attemptCount: number
    }
  >
  webhookEvents: Set<string>
}

const getRazorpayClientMock = razorpayClientModule.getRazorpayClient as jest.Mock

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

function getCounterValue(name: string): number {
  const snapshot = getMetricsSnapshot()
  const counter = snapshot.counters.find((entry) => entry.name === name)
  return counter?.value ?? 0
}

function buildPgConnectionMock(state: PgMockState) {
  const raw = jest.fn(async (query: string, bindings: unknown[] = []) => {
    if (query.includes("CREATE TABLE") || query.includes("CREATE INDEX")) {
      return { rows: [] }
    }

    if (query.includes("ALTER TABLE") || query.includes("UPDATE razorpay_session_order_v1")) {
      return { rows: [] }
    }

    if (query.includes("pg_advisory_xact_lock")) {
      return { rows: [] }
    }

    if (
      query.includes("FROM razorpay_session_order_v1") &&
      query.includes("payment_session_id = ?") &&
      query.includes("SELECT")
    ) {
      const sessionId = String(bindings[0] ?? "")
      const record = state.sessionOrders.get(sessionId)
      if (!record) {
        return {
          rows: [],
        }
      }

      if (query.includes("attempt_count")) {
        return {
          rows: [
            {
              razorpay_order_id: record.orderId,
              amount: record.amount,
              currency_code: record.currency,
              attempt_count: record.attemptCount,
            },
          ],
        }
      }

      return {
        rows: [{ razorpay_order_id: record.orderId }],
      }
    }

    if (query.includes("INSERT INTO razorpay_session_order_v1")) {
      const sessionId = String(bindings[0] ?? "")
      const orderId = String(bindings[1] ?? "")
      const amount = Number(bindings[2] ?? 0)
      const currency = String(bindings[3] ?? "INR")
      if (!state.sessionOrders.has(sessionId)) {
        state.sessionOrders.set(sessionId, {
          orderId,
          amount: Number.isFinite(amount) ? amount : 0,
          currency,
          attemptCount: 1,
        })
      }
      return { rows: [] }
    }

    if (query.includes("SELECT payment_session_id FROM razorpay_session_order_v1")) {
      const orderId = String(bindings[0] ?? "")
      const match = Array.from(state.sessionOrders.entries()).find(
        ([, stored]) => stored.orderId === orderId
      )

      return {
        rows: match ? [{ payment_session_id: match[0] }] : [],
      }
    }

    if (query.includes("INSERT INTO razorpay_webhook_events")) {
      const eventId = String(bindings[0] ?? "")
      if (state.webhookEvents.has(eventId)) {
        return { rows: [] }
      }

      state.webhookEvents.add(eventId)
      return { rows: [{ id: eventId }] }
    }

    return { rows: [] }
  })

  const trx: any = {
    raw,
    transaction: async (handler: (trxArg: any) => Promise<unknown>) => handler(trx),
  }

  let transactionChain = Promise.resolve()
  const runSerializedTransaction = async (handler: (trxArg: any) => Promise<unknown>) => {
    const previous = transactionChain
    let release: () => void = () => undefined
    transactionChain = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous
    try {
      return await handler(trx)
    } finally {
      release()
    }
  }

  return {
    raw,
    transaction: runSerializedTransaction,
  }
}

function makeProvider(params?: {
  paymentsMode?: "test" | "live"
  webhookSecret?: string
  allowUnverifiedWebhooks?: boolean
  pgState?: PgMockState
  client?: razorpayClientModule.RazorpayClient
}) {
  const state = params?.pgState ?? {
    sessionOrders: new Map<
      string,
      {
        orderId: string
        amount: number
        currency: string
        attemptCount: number
      }
    >(),
    webhookEvents: new Set<string>(),
  }
  const pgConnection = buildPgConnectionMock(state)

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }

  const client =
    params?.client ??
    ({
      orders: {
        create: jest.fn(async () => ({ id: "order_test_default" })),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient)

  getRazorpayClientMock.mockReturnValue(client)

  const provider = new RazorpayPaymentProviderService(
    {
      logger,
      [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection,
    } as any,
    {
      key_id: "rzp_test_abc123",
      key_secret: "secret_test_key",
      payments_mode: params?.paymentsMode ?? "test",
      webhook_secret: params?.webhookSecret ?? "whsec_test_123",
      test_auto_authorize: true,
      allow_unverified_webhooks: params?.allowUnverifiedWebhooks,
    }
  )

  return {
    provider,
    pgConnection,
    state,
    logger,
    client,
  }
}

describe("Razorpay payment provider", () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  afterEach(() => {
    jest.resetAllMocks()
    __resetMetricsForTests()
  })

  it("creates one Razorpay order per payment session (idempotent with lock)", async () => {
    const client = {
      orders: {
        create: jest.fn(async () => ({ id: "order_test_001" })),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient

    const { provider, logger } = makeProvider({ client })
    const input = {
      amount: 1499,
      currency_code: "INR",
      data: { session_id: "ps_001" },
    }

    const first = await provider.initiatePayment(input as any)
    const second = await provider.initiatePayment(input as any)

    expect(first.data?.razorpay_order_id).toBe("order_test_001")
    expect(first.data?.presentation_data).toEqual({
      type: "razorpay",
      keyId: "rzp_test_abc123",
      orderId: "order_test_001",
      amount: 1499,
      currency: "INR",
      prefill: undefined,
    })
    expect(second.data?.razorpay_order_id).toBe("order_test_001")
    expect(client.orders.create).toHaveBeenCalledTimes(1)
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain(
      "RAZORPAY_ORDER_CREATE_ATTEMPT"
    )
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain("RAZORPAY_ORDER_CREATED")
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain(
      "RAZORPAY_CHECKOUT_INITIATED"
    )
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain(
      "PAYMENT_PROVIDER_CALL_ATTEMPT"
    )
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain(
      "PAYMENT_PROVIDER_CALL_SUCCESS"
    )
    expect(getCounterValue("razorpay.order_create.success")).toBe(1)
  })

  it("includes Razorpay presentation prefill from backend context customer", async () => {
    const { provider } = makeProvider()
    const created = await provider.initiatePayment({
      amount: 1599,
      currency_code: "INR",
      data: { session_id: "ps_prefill_1" },
      context: {
        customer: {
          id: "cus_1",
          email: "buyer@example.com",
          first_name: "Test",
          last_name: "Buyer",
          phone: "9988776655",
        },
      },
    } as any)

    expect(created.data?.presentation_data).toEqual({
      type: "razorpay",
      keyId: "rzp_test_abc123",
      orderId: "order_test_default",
      amount: 1599,
      currency: "INR",
      prefill: {
        name: "Test Buyer",
        email: "buyer@example.com",
        phone: "9988776655",
      },
    })
  })

  it("creates only one Razorpay order for simultaneous initiate calls", async () => {
    const client = {
      orders: {
        create: jest.fn(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ id: "order_test_simultaneous" }), 25)
            )
        ),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient

    const { provider, logger } = makeProvider({ client })
    const input = {
      amount: 1499,
      currency_code: "INR",
      data: { session_id: "ps_concurrent_001" },
    }

    const [first, second] = await Promise.all([
      provider.initiatePayment(input as any),
      provider.initiatePayment(input as any),
    ])

    expect(first.data?.razorpay_order_id).toBe("order_test_simultaneous")
    expect(second.data?.razorpay_order_id).toBe("order_test_simultaneous")
    expect(client.orders.create).toHaveBeenCalledTimes(1)
  })

  it("enforces INR-only currency", async () => {
    const { provider } = makeProvider()

    await expect(
      provider.initiatePayment({
        amount: 1200,
        currency_code: "USD",
        data: { session_id: "ps_inr_only" },
      } as any)
    ).rejects.toMatchObject({
      code: "CURRENCY_NOT_SUPPORTED",
      details: {
        currency: "USD",
      },
    })
  })

  it("converts major-unit INR amount to paise integer", async () => {
    const client = {
      orders: {
        create: jest.fn(async () => ({ id: "order_test_paise" })),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient

    const { provider, logger } = makeProvider({ client })
    const created = await provider.initiatePayment({
      amount: 12.34,
      currency_code: "INR",
      data: { session_id: "ps_paise_1" },
    } as any)

    expect(created.data?.amount).toBe(1234)
    expect(client.orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1234,
        currency: "INR",
      })
    )
  })

  it("retries on 429 for status fetch and succeeds within max retries", async () => {
    const client = {
      orders: {
        create: jest.fn(async () => ({ id: "order_retry_ok" })),
      },
      payments: {
        fetch: jest
          .fn()
          .mockRejectedValueOnce({
            statusCode: 429,
            error: { description: "rate limited" },
          })
          .mockResolvedValueOnce({
            id: "pay_retry_ok",
            order_id: "order_retry_ok",
            amount: 2199,
            currency: "INR",
            status: "authorized",
          }),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient

    const { provider } = makeProvider({ client })
    const status = await provider.getPaymentStatus({
      data: {
        session_id: "ps_retry_1",
        razorpay_payment_id: "pay_retry_ok",
        amount: 2199,
        currency_code: "INR",
      },
    } as any)

    expect(status.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(client.payments.fetch).toHaveBeenCalledTimes(2)
  })

  it("does not retry on 429 for order creation (booking path)", async () => {
    const client = {
      orders: {
        create: jest.fn().mockRejectedValue({
          statusCode: 429,
          error: { description: "rate limited" },
        }),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient

    const { provider } = makeProvider({ client })

    await expect(
      provider.initiatePayment({
        amount: 2199,
        currency_code: "INR",
        data: { session_id: "ps_retry_1" },
      } as any)
    ).rejects.toMatchObject({
      code: "RAZORPAY_RATE_LIMIT",
      httpStatus: 429,
    })
    expect(client.orders.create).toHaveBeenCalledTimes(1)
  })

  it("does not retry on 429 for capture path", async () => {
    const client = {
      orders: {
        create: jest.fn(async () => ({ id: "order_capture_429_1" })),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn().mockRejectedValue({
          statusCode: 429,
          error: { description: "rate limited" },
        }),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient

    const { provider } = makeProvider({ client })

    await expect(
      provider.capturePayment({
        data: {
          session_id: "ps_capture_429_1",
          razorpay_payment_id: "pay_capture_429_1",
          razorpay_order_id: "order_capture_429_1",
          razorpay_payment_status: "authorized",
          amount: 1499,
          currency_code: "INR",
        },
      } as any)
    ).rejects.toMatchObject({
      code: "RAZORPAY_RATE_LIMIT",
      httpStatus: 429,
    })
    expect(client.payments.capture).toHaveBeenCalledTimes(1)
  })

  it("maps upstream 401 to RAZORPAY_AUTH_FAILED", async () => {
    const client = {
      orders: {
        create: jest.fn().mockRejectedValue({
          statusCode: 401,
          error: { description: "unauthorized" },
        }),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient
    const { provider } = makeProvider({ client })

    await expect(
      provider.initiatePayment({
        amount: 1499,
        currency_code: "INR",
        data: { session_id: "ps_auth_1" },
      } as any)
    ).rejects.toMatchObject({
      code: "RAZORPAY_AUTH_FAILED",
    })
  })

  it("maps upstream 400 to RAZORPAY_BAD_REQUEST", async () => {
    const client = {
      orders: {
        create: jest.fn().mockRejectedValue({
          statusCode: 400,
          error: { description: "bad request" },
        }),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient
    const { provider } = makeProvider({ client })

    await expect(
      provider.initiatePayment({
        amount: 1499,
        currency_code: "INR",
        data: { session_id: "ps_badreq_1" },
      } as any)
    ).rejects.toMatchObject({
      code: "RAZORPAY_BAD_REQUEST",
      httpStatus: 400,
    })
  })

  it("maps upstream 429 to RAZORPAY_RATE_LIMIT", async () => {
    const client = {
      orders: {
        create: jest.fn().mockRejectedValue({
          statusCode: 429,
          error: { description: "rate limited" },
        }),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient
    const { provider } = makeProvider({ client })

    await expect(
      provider.initiatePayment({
        amount: 1499,
        currency_code: "INR",
        data: { session_id: "ps_429_1" },
      } as any)
    ).rejects.toMatchObject({
      code: "RAZORPAY_RATE_LIMIT",
      httpStatus: 429,
    })
    expect(client.orders.create).toHaveBeenCalledTimes(1)
  })

  it("maps network/upstream failures to RAZORPAY_UPSTREAM_ERROR", async () => {
    const client = {
      orders: {
        create: jest.fn().mockRejectedValue(new Error("ECONNRESET")),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({})),
      },
    } as razorpayClientModule.RazorpayClient
    const { provider, logger } = makeProvider({ client })

    await expect(
      provider.initiatePayment({
        amount: 1499,
        currency_code: "INR",
        data: { session_id: "ps_upstream_1" },
      } as any)
    ).rejects.toMatchObject({
      code: "RAZORPAY_UPSTREAM_ERROR",
    })
    expect(getCounterValue("razorpay.order_create.fail")).toBe(1)
    expect(getLoggedMessages(logger.error as jest.Mock)).toContain(
      "PAYMENT_PROVIDER_CALL_FAIL"
    )
  })

  it("marks unpaid Razorpay order as canceled internally", async () => {
    const { provider, logger } = makeProvider()

    const canceled = await provider.cancelPayment({
      data: {
        session_id: "ps_cancel_1",
        razorpay_order_id: "order_cancel_1",
        razorpay_payment_status: "created",
      },
    } as any)

    expect(canceled.data).toMatchObject({
      razorpay_payment_status: "canceled",
      canceled_at: expect.any(String),
    })
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain("RAZORPAY_CANCEL_CALLED")
  })

  it("returns CANNOT_CANCEL_PAID_PAYMENT when payment is already paid", async () => {
    const { provider, logger } = makeProvider()

    await expect(
      provider.cancelPayment({
        data: {
          session_id: "ps_cancel_paid_1",
          razorpay_order_id: "order_cancel_paid_1",
          razorpay_payment_id: "pay_cancel_paid_1",
          razorpay_payment_status: "captured",
        },
      } as any)
    ).rejects.toMatchObject({
      code: "CANNOT_CANCEL_PAID_PAYMENT",
      httpStatus: 409,
    })
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain("RAZORPAY_CANCEL_CALLED")
  })

  it("refunds captured Razorpay payment and stores refund details", async () => {
    const client = {
      orders: {
        create: jest.fn(async () => ({ id: "order_refund_1" })),
      },
      payments: {
        fetch: jest.fn(async () => ({})),
        capture: jest.fn(async () => ({})),
        refund: jest.fn(async () => ({
          id: "rfnd_live_1",
          payment_id: "pay_refund_1",
          amount: 1000,
          status: "processed",
        })),
      },
    } as razorpayClientModule.RazorpayClient

    const { provider, logger } = makeProvider({ client })
    const refunded = await provider.refundPayment({
      amount: 1000,
      data: {
        session_id: "ps_refund_1",
        razorpay_order_id: "order_refund_1",
        razorpay_payment_id: "pay_refund_1",
        razorpay_payment_status: "captured",
      },
    } as any)

    expect(refunded.data).toMatchObject({
      razorpay_refund_id: "rfnd_live_1",
      razorpay_payment_status: "refunded",
      refunded_at: expect.any(String),
    })
    expect(client.payments.refund).toHaveBeenCalledWith("pay_refund_1", {
      amount: 1000,
    })
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain("RAZORPAY_REFUND_CALLED")
  })

  it("verifies checkout signature and marks payment authorized", async () => {
    const { provider, logger } = makeProvider()
    const orderId = "order_auth_1"
    const paymentId = "pay_auth_1"
    const signature = crypto
      .createHmac("sha256", "secret_test_key")
      .update(`${orderId}|${paymentId}`)
      .digest("hex")

    const authorized = await provider.authorizePayment({
      data: {
        session_id: "ps_auth_signature_1",
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      },
    } as any)

    expect(authorized.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(authorized.data).toMatchObject({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_payment_status: "authorized",
      razorpay_signature_verified: true,
      verified_at: expect.any(String),
      authorized_at: expect.any(String),
    })
    expect(authorized.data?.razorpay_signature).toBeUndefined()
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain(
      "RAZORPAY_SIGNATURE_VERIFICATION_OK"
    )
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain("RAZORPAY_SIGNATURE_OK")
    expect(getCounterValue("razorpay.authorize.success")).toBe(1)
    const allLogLines = [
      ...(logger.info as jest.Mock).mock.calls.map((call) => call[0]),
      ...(logger.warn as jest.Mock).mock.calls.map((call) => call[0]),
      ...(logger.error as jest.Mock).mock.calls.map((call) => call[0]),
    ]
      .filter((entry) => typeof entry === "string")
      .join("\n")
    expect(allLogLines).not.toContain("secret_test_key")
  })

  it("returns SIGNATURE_INVALID on checkout signature mismatch", async () => {
    const { provider, logger } = makeProvider()

    await expect(
      provider.authorizePayment({
        data: {
          session_id: "ps_auth_signature_invalid_1",
          razorpay_order_id: "order_auth_invalid_1",
          razorpay_payment_id: "pay_auth_invalid_1",
          razorpay_signature: "invalid_signature",
        },
      } as any)
    ).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
    })
    expect(getLoggedMessages(logger.warn as jest.Mock)).toContain(
      "RAZORPAY_SIGNATURE_VERIFICATION_FAIL"
    )
    expect(getLoggedMessages(logger.warn as jest.Mock)).toContain("RAZORPAY_SIGNATURE_FAIL")
    expect(getCounterValue("razorpay.authorize.fail")).toBe(1)
  })

  it("returns VALIDATION_ERROR when authorize payload fields are missing", async () => {
    const { provider, logger } = makeProvider()

    await expect(
      provider.authorizePayment({
        data: {
          session_id: "ps_auth_missing_fields_1",
          razorpay_order_id: "order_missing_1",
          razorpay_payment_id: "pay_missing_1",
        },
      } as any)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        missing_fields: ["razorpay_signature"],
      },
    })
    expect(getLoggedMessages(logger.warn as jest.Mock)).toContain(
      "RAZORPAY_SIGNATURE_VERIFICATION_FAIL"
    )
  })

  it("transitions payment session state to AUTHORIZED after successful verification", async () => {
    const { provider } = makeProvider()
    const orderId = "order_auth_state_1"
    const paymentId = "pay_auth_state_1"
    const signature = crypto
      .createHmac("sha256", "secret_test_key")
      .update(`${orderId}|${paymentId}`)
      .digest("hex")

    const authorized = await provider.authorizePayment({
      data: {
        session_id: "ps_auth_state_1",
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      },
    } as any)
    const status = await provider.getPaymentStatus({
      data: authorized.data,
    } as any)

    expect(authorized.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(status.status).toBe(PaymentSessionStatus.AUTHORIZED)
  })

  it("verifies webhook signature and de-duplicates by event id", async () => {
    const { provider, logger } = makeProvider({ webhookSecret: "webhook_secret_1" })

    const body = {
      event: "payment.authorized",
      payload: {
        payment: {
          entity: {
            id: "pay_123",
            amount: 999,
            notes: {
              session_id: "ps_webhook_1",
            },
          },
        },
      },
    }
    const rawBody = Buffer.from(JSON.stringify(body))
    const signature = crypto
      .createHmac("sha256", "webhook_secret_1")
      .update(rawBody)
      .digest("hex")

    const payload = {
      rawData: rawBody,
      data: body,
      headers: {
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": "evt_001",
      },
    }

    const first = await provider.getWebhookActionAndData(payload as any)
    const second = await provider.getWebhookActionAndData(payload as any)

    expect(first.action).toBe(PaymentActions.AUTHORIZED)
    expect(first.data?.session_id).toBe("ps_webhook_1")
    expect(second.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain("WEBHOOK_DEDUP_HIT")
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain("RAZORPAY_WEBHOOK_OK")
    expect(getCounterValue("razorpay.webhook.success")).toBe(2)
  })

  it("de-duplicates webhook using derived hash when event id header is missing", async () => {
    const { provider } = makeProvider({ webhookSecret: "webhook_secret_2" })
    const body = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_derived_1",
            amount: 1299,
            notes: {
              session_id: "ps_webhook_derived",
            },
          },
        },
      },
    }
    const rawBody = Buffer.from(JSON.stringify(body))
    const signature = crypto
      .createHmac("sha256", "webhook_secret_2")
      .update(rawBody)
      .digest("hex")
    const payload = {
      rawData: rawBody,
      data: body,
      headers: {
        "x-razorpay-signature": signature,
      },
    }

    const first = await provider.getWebhookActionAndData(payload as any)
    const second = await provider.getWebhookActionAndData(payload as any)

    expect(first.action).toBe(PaymentActions.SUCCESSFUL)
    expect(second.action).toBe(PaymentActions.NOT_SUPPORTED)
  })

  it("handles NOT_SUPPORTED webhook action without crashing when only fallback event id is available", async () => {
    const { provider } = makeProvider({ webhookSecret: "webhook_secret_not_supported" })
    const body = {
      event: "order.paid",
      payload: {
        payment: {
          entity: {
            id: "pay_not_supported_1",
            amount: 999,
            notes: {
              session_id: "ps_not_supported_1",
            },
          },
        },
      },
    }
    const rawBody = Buffer.from(JSON.stringify(body))
    const signature = crypto
      .createHmac("sha256", "webhook_secret_not_supported")
      .update(rawBody)
      .digest("hex")

    const result = await provider.getWebhookActionAndData({
      rawData: rawBody,
      data: body,
      headers: {
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": "evt_not_supported_1",
      },
    } as any)

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
  })

  it("handles missing session webhook branch using fallback event id", async () => {
    const { provider } = makeProvider({ webhookSecret: "webhook_secret_missing_session" })
    const body = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_missing_session_1",
            amount: 999,
            notes: {},
          },
        },
      },
    }
    const rawBody = Buffer.from(JSON.stringify(body))
    const signature = crypto
      .createHmac("sha256", "webhook_secret_missing_session")
      .update(rawBody)
      .digest("hex")

    const result = await provider.getWebhookActionAndData({
      rawData: rawBody,
      data: body,
      headers: {
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": "evt_missing_session_1",
      },
    } as any)

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
  })

  it("logs webhook failure and increments fail metric on invalid signature", async () => {
    const { provider, logger } = makeProvider({ webhookSecret: "webhook_secret_invalid" })
    const body = {
      event: "payment.authorized",
      payload: {
        payment: {
          entity: {
            id: "pay_invalid_sig_1",
            amount: 999,
            notes: {
              session_id: "ps_webhook_invalid_1",
            },
          },
        },
      },
    }
    const payload = {
      rawData: Buffer.from(JSON.stringify(body)),
      data: body,
      headers: {
        "x-razorpay-signature": "invalid_signature",
      },
    }

    await expect(provider.getWebhookActionAndData(payload as any)).rejects.toMatchObject({
      code: "RAZORPAY_SIGNATURE_INVALID",
    })
    expect(getLoggedMessages(logger.error as jest.Mock)).toContain("RAZORPAY_WEBHOOK_FAIL")
    expect(getCounterValue("razorpay.webhook.fail")).toBe(1)
  })

  it("rejects unverified webhook by default", async () => {
    const { provider } = makeProvider({ webhookSecret: "" })
    const body = {
      event: "payment.authorized",
      payload: {
        payment: {
          entity: {
            id: "pay_missing_secret_1",
            amount: 500,
            notes: {
              session_id: "ps_webhook_missing_secret",
            },
          },
        },
      },
    }

    await expect(
      provider.getWebhookActionAndData({
        rawData: Buffer.from(JSON.stringify(body)),
        data: body,
        headers: {},
      } as any)
    ).rejects.toMatchObject({
      code: "RAZORPAY_WEBHOOK_SECRET_MISSING",
    })
  })

  it("accepts unverified webhook only when explicit override flag is enabled", async () => {
    const { provider, logger } = makeProvider({
      webhookSecret: "",
      allowUnverifiedWebhooks: true,
    })
    const body = {
      event: "payment.authorized",
      payload: {
        payment: {
          entity: {
            id: "pay_unverified_allowed_1",
            amount: 999,
            notes: {
              session_id: "ps_webhook_unverified_allowed",
            },
          },
        },
      },
    }

    const result = await provider.getWebhookActionAndData({
      rawData: Buffer.from(JSON.stringify(body)),
      data: body,
      headers: {},
    } as any)

    expect(result.action).toBe(PaymentActions.AUTHORIZED)
    expect(getLoggedMessages(logger.warn as jest.Mock)).toContain(
      "PAYMENT_WEBHOOK_UNVERIFIED_ALLOWED"
    )
  })

  it("enforces PAYMENTS_MODE and key prefix guardrails", () => {
    expect(() =>
      RazorpayPaymentProviderService.validateOptions({
        key_id: "rzp_live_123",
        key_secret: "secret",
        payments_mode: "test",
      })
    ).toThrow()

    expect(() =>
      RazorpayPaymentProviderService.validateOptions({
        key_id: "rzp_test_123",
        key_secret: "secret",
        payments_mode: "live",
      })
    ).toThrow()
  })
})
