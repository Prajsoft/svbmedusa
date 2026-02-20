import { POST as webhookRoute } from "../[provider]/route"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

function makeRes() {
  const res: any = {
    statusCode: 200,
    payload: undefined as unknown,
    status: jest.fn(function (code: number) {
      res.statusCode = code
      return res
    }),
    json: jest.fn(function (body: unknown) {
      res.payload = body
      return res
    }),
  }

  return res
}

function makeReq(input: {
  provider?: string
  emitImpl?: () => Promise<void>
  correlationIdHeader?: string
}) {
  const emit = jest.fn(input.emitImpl ?? (async () => undefined))
  const logger = {
    info: jest.fn(),
    error: jest.fn(),
  }

  const req: any = {
    params: {
      provider: input.provider,
    },
    body: { event: "payment.authorized" },
    rawBody: Buffer.from(JSON.stringify({ event: "payment.authorized" })),
    headers: input.correlationIdHeader
      ? { "x-correlation-id": input.correlationIdHeader }
      : {},
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER) {
          return logger
        }

        if (key === Modules.EVENT_BUS) {
          return { emit }
        }

        if (key === Modules.PAYMENT) {
          return {
            options: {
              webhook_delay: 10,
              webhook_retries: 2,
            },
          }
        }

        return undefined
      },
    },
  }

  return { req, emit, logger }
}

describe("payment webhook route", () => {
  it("returns correlation_id on success", async () => {
    const { req, emit } = makeReq({
      provider: "razorpay_razorpay",
      correlationIdHeader: "corr_123",
    })
    const res = makeRes()

    await webhookRoute(req, res)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      provider: "razorpay_razorpay",
      correlation_id: "corr_123",
    })
  })

  it("returns required error envelope when provider is missing", async () => {
    const { req } = makeReq({ provider: "" })
    const res = makeRes()

    await webhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.payload).toEqual({
      error: {
        code: "PAYMENT_PROVIDER_REQUIRED",
        message: "Webhook provider param is required.",
        details: {},
        correlation_id: expect.any(String),
      },
    })
  })

  it("returns required error envelope when webhook enqueue fails", async () => {
    const { req } = makeReq({
      provider: "razorpay_razorpay",
      emitImpl: async () => {
        throw new Error("event bus unavailable")
      },
    })
    const res = makeRes()

    await webhookRoute(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.payload).toEqual({
      error: {
        code: "PAYMENT_WEBHOOK_FAILED",
        message: "event bus unavailable",
        details: {
          provider: "razorpay_razorpay",
        },
        correlation_id: expect.any(String),
      },
    })
  })
})
