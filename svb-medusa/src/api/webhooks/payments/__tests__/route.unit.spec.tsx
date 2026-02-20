import crypto from "crypto"
import { POST as paymentsWebhookRoute } from "../[provider]/route"
import {
  ContainerRegistrationKeys,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

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

function buildBody(input?: {
  event?: string
  sessionId?: string
  paymentStatus?: string
}): Record<string, unknown> {
  return {
    event: input?.event ?? "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_route_1",
          order_id: "order_route_1",
          status: input?.paymentStatus ?? "captured",
          notes: {
            session_id: input?.sessionId ?? "payses_route_1",
          },
        },
      },
    },
  }
}

function signBody(body: Record<string, unknown>, secret: string): string {
  const rawBody = Buffer.from(JSON.stringify(body))
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
}

function makeReq(input?: {
  body?: Record<string, unknown>
  provider?: string
  headers?: Record<string, string>
  paymentSessionStatus?: string
}) {
  const events = new Set<string>()
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }

  const body = input?.body ?? buildBody()
  const rawBody = Buffer.from(JSON.stringify(body))
  const defaultHeaders = input?.headers ?? {}

  const paymentModule = {
    updatePaymentSession: jest.fn(async () => ({ id: "payses_route_1" })),
  }

  const query = {
    graph: jest.fn(async () => ({
      data: [
        {
          id: "payses_route_1",
          status: input?.paymentSessionStatus ?? "pending",
          amount: 1499,
          currency_code: "INR",
          data: {
            payment_status: "PENDING",
          },
        },
      ],
    })),
  }

  const pgConnection = {
    raw: jest.fn(async (queryText: string, bindings: unknown[] = []) => {
      if (queryText.includes("CREATE TABLE")) {
        return { rows: [] }
      }
      if (queryText.includes("INSERT INTO payment_webhook_events")) {
        const provider = String(bindings[0] ?? "").trim().toLowerCase()
        const eventId = String(bindings[1] ?? "").trim()
        const key = `${provider}:${eventId}`
        if (events.has(key)) {
          return { rows: [] }
        }
        events.add(key)
        return { rows: [{ provider, event_id: eventId }] }
      }

      return { rows: [] }
    }),
  }

  const req: any = {
    params: {
      provider: input?.provider ?? "razorpay",
    },
    body,
    rawBody,
    headers: defaultHeaders,
    scope: {
      resolve: (key: string) => {
        if (key === Modules.PAYMENT) {
          return paymentModule
        }
        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }
        if (key === ContainerRegistrationKeys.PG_CONNECTION) {
          return pgConnection
        }
        if (key === ContainerRegistrationKeys.LOGGER || key === "logger") {
          return logger
        }
        return undefined
      },
    },
  }

  return {
    req,
    paymentModule,
    query,
    logger,
  }
}

describe("shared payments webhook route", () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.resetAllMocks()
    process.env = {
      ...OLD_ENV,
      RAZORPAY_WEBHOOK_SECRET: "whsec_route_test",
      ALLOW_UNSIGNED_WEBHOOKS: "false",
    }
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  it("dedupes repeated events and ignores second delivery", async () => {
    const body = buildBody({
      event: "payment.authorized",
    })
    const signature = signBody(body, "whsec_route_test")
    const { req, paymentModule, logger } = makeReq({
      body,
      headers: {
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": "evt_shared_dedup_1",
      },
    })
    const firstRes = makeRes()
    const secondRes = makeRes()

    await paymentsWebhookRoute(req, firstRes)
    await paymentsWebhookRoute(req, secondRes)

    expect(firstRes.status).toHaveBeenCalledWith(200)
    expect(firstRes.payload).toEqual({
      ok: true,
      processed: true,
      deduped: false,
      provider: "razorpay",
      event_id: "evt_shared_dedup_1",
      event_type: "payment.authorized",
      payment_session_id: "payses_route_1",
      correlation_id: expect.any(String),
    })

    expect(secondRes.status).toHaveBeenCalledWith(200)
    expect(secondRes.payload).toEqual({
      ok: true,
      processed: false,
      deduped: true,
      provider: "razorpay",
      event_id: "evt_shared_dedup_1",
      event_type: "payment.authorized",
      payment_session_id: null,
      correlation_id: expect.any(String),
    })
    expect(paymentModule.updatePaymentSession).toHaveBeenCalledTimes(1)
    expect(getLoggedMessages(logger.info as jest.Mock)).toContain("WEBHOOK_DEDUP_HIT")
  })

  it("rejects invalid signature with 401 and correlation id", async () => {
    const body = buildBody()
    const { req } = makeReq({
      body,
      headers: {
        "x-razorpay-signature": "invalid",
        "x-razorpay-event-id": "evt_invalid_sig_1",
      },
    })
    const res = makeRes()

    await paymentsWebhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.payload).toEqual({
      error: {
        code: "SIGNATURE_INVALID",
        message: "Invalid webhook signature.",
        details: {},
        correlation_id: expect.any(String),
      },
    })
  })

  it("applies state transition and persists payment session status", async () => {
    const body = buildBody({
      event: "payment.captured",
      paymentStatus: "captured",
    })
    const signature = signBody(body, "whsec_route_test")
    const { req, paymentModule } = makeReq({
      body,
      paymentSessionStatus: "pending",
      headers: {
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": "evt_transition_1",
      },
    })
    const res = makeRes()

    await paymentsWebhookRoute(req, res)

    expect(paymentModule.updatePaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "payses_route_1",
        status: PaymentSessionStatus.CAPTURED,
        data: expect.objectContaining({
          payment_status: "CAPTURED",
          provider_event_id: "evt_transition_1",
          razorpay_payment_id: "pay_route_1",
          razorpay_order_id: "order_route_1",
        }),
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.payload).toEqual(
      expect.objectContaining({
        ok: true,
        processed: true,
        deduped: false,
        event_type: "payment.captured",
      })
    )
  })

  it("returns VALIDATION_ERROR + correlation_id on invalid event mapping", async () => {
    const body = buildBody({
      event: "payment.unknown",
    })
    const signature = signBody(body, "whsec_route_test")
    const { req } = makeReq({
      body,
      headers: {
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": "evt_invalid_map_1",
      },
    })
    const res = makeRes()

    await paymentsWebhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.payload).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Unsupported or invalid webhook event mapping.",
        details: {
          event_type: "payment.unknown",
        },
        correlation_id: expect.any(String),
      },
    })
  })

  it("rejects unsupported provider routes with PROVIDER_UNAVAILABLE", async () => {
    const body = buildBody({
      event: "payment.captured",
      paymentStatus: "captured",
    })
    const { req } = makeReq({
      provider: "cod",
      body,
    })
    const res = makeRes()

    await paymentsWebhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.payload).toEqual({
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "Webhook provider is not supported: cod",
        details: {
          provider: "cod",
        },
        correlation_id: expect.any(String),
      },
    })
  })
})
