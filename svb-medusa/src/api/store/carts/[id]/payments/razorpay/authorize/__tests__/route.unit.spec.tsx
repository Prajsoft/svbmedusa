import { POST as authorizeRoute } from "../route"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

type SessionShape = {
  id: string
  provider_id: string
  status: string
  data?: Record<string, unknown>
}

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

function makeReq(input?: {
  body?: Record<string, unknown>
  sessions?: SessionShape[]
  refreshedSessions?: SessionShape[]
}) {
  const authorizePaymentSession = jest.fn(async () => ({ id: "payses_target" }))
  const sessions = input?.sessions ?? []
  const refreshedSessions = input?.refreshedSessions ?? sessions

  const query = {
    graph: jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: "cart_test_1",
            payment_collection: {
              id: "pay_col_test_1",
              payment_sessions: sessions,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "cart_test_1",
            payment_collection: {
              id: "pay_col_test_1",
              payment_sessions: refreshedSessions,
            },
          },
        ],
      }),
  }

  const req: any = {
    params: {
      id: "cart_test_1",
    },
    body: {
      provider_id: "pp_razorpay_razorpay",
      razorpay_order_id: "order_test_1",
      razorpay_payment_id: "pay_test_1",
      razorpay_signature: "sig_test_1",
      internal_reference: "cart_test_1",
      ...(input?.body ?? {}),
    },
    headers: {},
    scope: {
      resolve: (key: string) => {
        if (key === Modules.PAYMENT) {
          return { authorizePaymentSession }
        }

        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }

        return undefined
      },
    },
  }

  return { req, query, authorizePaymentSession }
}

describe("store cart Razorpay authorize route", () => {
  it("authorizes the matching existing Razorpay session", async () => {
    const { req, authorizePaymentSession } = makeReq({
      sessions: [
        {
          id: "payses_other",
          provider_id: "pp_razorpay_razorpay",
          status: "pending",
          data: {
            razorpay_order_id: "order_other",
          },
        },
        {
          id: "payses_target",
          provider_id: "pp_razorpay_razorpay",
          status: "pending",
          data: {
            razorpay_order_id: "order_test_1",
          },
        },
      ],
      refreshedSessions: [
        {
          id: "payses_target",
          provider_id: "pp_razorpay_razorpay",
          status: "authorized",
          data: {
            correlation_id: "corr_authorized_1",
            razorpay_order_id: "order_test_1",
            razorpay_payment_id: "pay_test_1",
            razorpay_payment_status: "authorized",
            verified_at: "2026-03-11T05:00:00.000Z",
          },
        },
      ],
    })
    const res = makeRes()

    await authorizeRoute(req, res)

    expect(authorizePaymentSession).toHaveBeenCalledWith(
      "payses_target",
      expect.objectContaining({
        provider_id: "pp_razorpay_razorpay",
        razorpay_order_id: "order_test_1",
        razorpay_payment_id: "pay_test_1",
        razorpay_signature: "sig_test_1",
        internal_reference: "cart_test_1",
        cart_id: "cart_test_1",
        correlation_id: expect.any(String),
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.payload).toEqual({
      ok: true,
      authorized: true,
      correlation_id: expect.any(String),
      payment_session: {
        id: "payses_target",
        provider_id: "pp_razorpay_razorpay",
        status: "authorized",
        data: {
          correlation_id: "corr_authorized_1",
          razorpay_order_id: "order_test_1",
          razorpay_payment_id: "pay_test_1",
          razorpay_payment_status: "authorized",
          verified_at: "2026-03-11T05:00:00.000Z",
          authorized_at: null,
          captured_at: null,
        },
      },
    })
  })

  it("returns the existing completed session without reauthorizing it", async () => {
    const { req, authorizePaymentSession } = makeReq({
      sessions: [
        {
          id: "payses_done",
          provider_id: "pp_razorpay_razorpay",
          status: "authorized",
          data: {
            correlation_id: "corr_done_1",
            razorpay_order_id: "order_test_1",
            razorpay_payment_id: "pay_test_1",
            razorpay_payment_status: "captured",
            verified_at: "2026-03-11T05:01:00.000Z",
          },
        },
      ],
    })
    const res = makeRes()

    await authorizeRoute(req, res)

    expect(authorizePaymentSession).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.payload).toEqual({
      ok: true,
      authorized: true,
      correlation_id: expect.any(String),
      payment_session: {
        id: "payses_done",
        provider_id: "pp_razorpay_razorpay",
        status: "authorized",
        data: {
          correlation_id: "corr_done_1",
          razorpay_order_id: "order_test_1",
          razorpay_payment_id: "pay_test_1",
          razorpay_payment_status: "captured",
          verified_at: "2026-03-11T05:01:00.000Z",
          authorized_at: null,
          captured_at: null,
        },
      },
    })
  })

  it("returns validation details when required fields are missing", async () => {
    const { req, authorizePaymentSession } = makeReq({
      body: {
        razorpay_signature: "",
      },
      sessions: [],
    })
    const res = makeRes()

    await authorizeRoute(req, res)

    expect(authorizePaymentSession).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.payload).toEqual({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining(
        "Missing required Razorpay authorization fields."
      ),
      details: {
        missing_fields: ["razorpay_signature"],
      },
      correlation_id: expect.any(String),
      error: {
        code: "VALIDATION_ERROR",
        message: "Missing required Razorpay authorization fields.",
        details: {
          missing_fields: ["razorpay_signature"],
        },
        correlation_id: expect.any(String),
      },
    })
  })
})
