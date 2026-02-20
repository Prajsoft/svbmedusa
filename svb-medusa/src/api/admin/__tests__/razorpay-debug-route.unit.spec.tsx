import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { GET as getRazorpayDebug } from "../ops/debug/razorpay-payment/route"

function makeRes() {
  const res: any = {
    statusCode: 200,
    payload: undefined as unknown,
    json: jest.fn(function (payload: unknown) {
      res.payload = payload
      return res
    }),
    status: jest.fn(function (code: number) {
      res.statusCode = code
      return res
    }),
  }

  return res
}

function makeScope() {
  const query = {
    graph: jest.fn(async ({ entity, filters }: { entity: string; filters?: any }) => {
      if (entity === "order") {
        if (filters?.id === "order_1") {
          return {
            data: [
              {
                id: "order_1",
                cart_id: "cart_1",
              },
            ],
          }
        }
        return { data: [] }
      }

      if (entity === "cart") {
        if (filters?.id === "cart_1") {
          return {
            data: [
              {
                id: "cart_1",
                payment_collection: {
                  id: "paycol_1",
                  payment_sessions: [
                    {
                      id: "payses_raz_1",
                      provider_id: "pp_razorpay_razorpay",
                      status: "authorized",
                      data: {
                        session_id: "payses_raz_1",
                        cart_id: "cart_1",
                        order_id: "order_1",
                        razorpay_order_id: "order_test_1",
                        razorpay_payment_id: "pay_test_1",
                        razorpay_payment_status: "authorized",
                        verified_at: "2026-02-20T00:00:00.000Z",
                        authorized_at: "2026-02-20T00:00:00.000Z",
                      },
                    },
                    {
                      id: "payses_cod_1",
                      provider_id: "pp_cod_cod",
                      status: "pending",
                      data: {},
                    },
                  ],
                },
              },
            ],
          }
        }
        return { data: [] }
      }

      return { data: [] }
    }),
  }

  return {
    query,
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }
        return undefined
      },
    },
  }
}

describe("admin razorpay debug lookup route", () => {
  it("looks up Razorpay payment metadata by cart_id", async () => {
    const { scope } = makeScope()
    const req: any = {
      scope,
      query: { cart_id: "cart_1" },
      auth_context: { actor_id: "admin_1" },
    }
    const res = makeRes()

    await getRazorpayDebug(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.payload).toEqual({
      order_id: null,
      cart_id: "cart_1",
      payment_collection_id: "paycol_1",
      razorpay_sessions: [
        {
          id: "payses_raz_1",
          provider_id: "pp_razorpay_razorpay",
          status: "authorized",
          metadata: expect.objectContaining({
            razorpay_order_id: "order_test_1",
            razorpay_payment_id: "pay_test_1",
            razorpay_payment_status: "authorized",
          }),
        },
      ],
      count: 1,
    })
  })

  it("looks up Razorpay payment metadata by order_id", async () => {
    const { scope, query } = makeScope()
    const req: any = {
      scope,
      query: { order_id: "order_1" },
      auth_context: { actor_id: "admin_1" },
    }
    const res = makeRes()

    await getRazorpayDebug(req, res)

    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "order",
        filters: { id: "order_1" },
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.payload).toEqual(
      expect.objectContaining({
        order_id: "order_1",
        cart_id: "cart_1",
        count: 1,
      })
    )
  })

  it("returns UNAUTHORIZED when actor is missing", async () => {
    const { scope } = makeScope()
    const req: any = {
      scope,
      query: { cart_id: "cart_1" },
    }
    const res = makeRes()

    await getRazorpayDebug(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.payload).toEqual(
      expect.objectContaining({
        code: "UNAUTHORIZED",
      })
    )
  })
})
