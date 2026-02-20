import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  makeCheckoutPaymentWorkflowMiddleware,
  validateStoreCodPaymentAuthorizeWorkflow,
} from "../middlewares"
import {
  __resetMetricsForTests,
  getMetricsSnapshot,
} from "../../modules/observability/metrics"

function makeCodCart() {
  return {
    id: "cart_cod_1",
    grand_total: 1999,
    total: 1999,
    subtotal: 1999,
    discount_total: 0,
    shipping_total: 0,
    original_shipping_total: 0,
    coupon_code: null as string | null,
    promotions: [] as Array<{ code: string; is_automatic?: boolean }>,
    discount_codes: [] as Array<{ code: string; is_automatic?: boolean }>,
    payment_collection: {
      id: "paycol_1",
      amount: 1999,
      currency_code: "INR",
      payment_sessions: [] as Array<{
        id: string
        provider_id: string
        status: string
      }>,
    },
    shipping_methods: [
      {
        shipping_option_id: "so_cod",
        shipping_option: {
          id: "so_cod",
          name: "Cash on Delivery",
          metadata: { payment_type: "cod" },
        },
      },
    ],
  }
}

function makeCodCartWithCoupon() {
  const cart = makeCodCart()
  cart.coupon_code = "SAVE10"
  cart.discount_codes = [{ code: "SAVE10", is_automatic: false }]
  cart.discount_total = 200
  cart.total = 1799
  cart.grand_total = 1799
  return cart
}

describe("COD checkout workflow wiring", () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it("COD checkout path completes to order placement", async () => {
    const cart = makeCodCart()

    const query = {
      graph: jest.fn(async ({ entity }: { entity: string }) => {
        if (entity === "cart") {
          return { data: [cart] }
        }

        if (entity === "shipping_option") {
          return {
            data: [
              {
                id: "so_cod",
                name: "Cash on Delivery",
                metadata: { payment_type: "cod" },
              },
            ],
          }
        }

        return { data: [] }
      }),
    }

    const payment = {
      deletePaymentSession: jest.fn(async () => undefined),
      createPaymentSession: jest.fn(async () => {
        cart.payment_collection.payment_sessions = [
          {
            id: "payses_cod_1",
            provider_id: "pp_cod_cod",
            status: "pending",
          },
        ]
      }),
      authorizePaymentSession: jest.fn(async () => {
        cart.payment_collection.payment_sessions = [
          {
            id: "payses_cod_1",
            provider_id: "pp_cod_cod",
            status: "authorized",
          },
        ]
        return { id: "pay_1" }
      }),
    }

    const eventBus = {
      emit: jest.fn(async () => undefined),
    }

    const scope = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }

        if (key === Modules.PAYMENT) {
          return payment
        }

        if (key === Modules.EVENT_BUS) {
          return eventBus
        }

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const req = {
      scope,
      params: { id: "cart_cod_1" },
      body: {},
      auth_context: { actor_id: "cus_1" },
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const orderPlace = jest.fn()
    const next = jest.fn(() => {
      orderPlace()
    })

    const middleware = makeCheckoutPaymentWorkflowMiddleware(
      validateStoreCodPaymentAuthorizeWorkflow
    )
    await middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(orderPlace).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect(payment.createPaymentSession).toHaveBeenCalledTimes(1)
    expect(payment.authorizePaymentSession).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "payment.authorized",
      })
    )

    const snapshot = getMetricsSnapshot()
    const durationMetric = snapshot.timers.find(
      (entry) => entry.name === "workflow.order_place.duration_ms"
    )
    expect(durationMetric).toEqual(
      expect.objectContaining({
        count: 1,
        labels: expect.objectContaining({
          workflow: "order_place",
          result: "success",
        }),
      })
    )

    const successCounter = snapshot.counters.find(
      (entry) => entry.name === "workflow.order_place.success_total"
    )
    expect(successCounter).toEqual(
      expect.objectContaining({
        labels: expect.objectContaining({
          workflow: "order_place",
          result: "success",
        }),
        value: 1,
      })
    )
  })

  it("if payment is not authorized, order placement fails", async () => {
    const cart = makeCodCart()

    const query = {
      graph: jest.fn(async ({ entity }: { entity: string }) => {
        if (entity === "cart") {
          return { data: [cart] }
        }

        return { data: [] }
      }),
    }

    const payment = {
      deletePaymentSession: jest.fn(async () => undefined),
      createPaymentSession: jest.fn(async () => {
        cart.payment_collection.payment_sessions = [
          {
            id: "payses_cod_2",
            provider_id: "pp_cod_cod",
            status: "pending",
          },
        ]
      }),
      authorizePaymentSession: jest.fn(async () => {
        cart.payment_collection.payment_sessions = [
          {
            id: "payses_cod_2",
            provider_id: "pp_cod_cod",
            status: "pending",
          },
        ]
        return { id: "pay_2" }
      }),
    }

    const eventBus = {
      emit: jest.fn(async () => undefined),
    }

    const scope = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }

        if (key === Modules.PAYMENT) {
          return payment
        }

        if (key === Modules.EVENT_BUS) {
          return eventBus
        }

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const req = {
      scope,
      params: { id: "cart_cod_1" },
      body: {},
      auth_context: { actor_id: "cus_1" },
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const orderPlace = jest.fn()
    const next = jest.fn(() => {
      orderPlace()
    })

    const middleware = makeCheckoutPaymentWorkflowMiddleware(
      validateStoreCodPaymentAuthorizeWorkflow
    )
    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(orderPlace).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PAYMENT_NOT_AUTHORIZED",
        message: expect.stringContaining("Support Code:"),
        details: {},
        correlation_id: expect.any(String),
        error: {
          code: "PAYMENT_NOT_AUTHORIZED",
          message: "COD payment authorization failed before order placement.",
          details: {},
          correlation_id: expect.any(String),
        },
      })
    )
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it("coupon valid at cart time but invalid at order time is blocked", async () => {
    const cart = makeCodCartWithCoupon()
    cart.payment_collection.payment_sessions = [
      {
        id: "payses_cod_3",
        provider_id: "pp_cod_cod",
        status: "authorized",
      },
    ]

    const query = {
      graph: jest.fn(async ({ entity }: { entity: string }) => {
        if (entity === "cart") {
          return { data: [cart] }
        }

        if (entity === "shipping_option") {
          return {
            data: [
              {
                id: "so_cod",
                name: "Cash on Delivery",
                metadata: { payment_type: "cod" },
              },
            ],
          }
        }

        if (entity === "promotion") {
          return {
            data: [
              {
                id: "promo_1",
                code: "SAVE10",
                limit: 100,
                used: 10,
                campaign: { budget: { limit: null, used: 0 } },
              },
            ],
          }
        }

        return { data: [] }
      }),
    }

    const workflowEngine = {
      run: jest.fn(async () => {
        cart.coupon_code = null
        cart.discount_codes = []
        cart.discount_total = 0
        cart.total = 1999
        cart.grand_total = 1999
      }),
    }

    const payment = {
      deletePaymentSession: jest.fn(async () => undefined),
      createPaymentSession: jest.fn(async () => undefined),
      authorizePaymentSession: jest.fn(async () => undefined),
    }

    const eventBus = {
      emit: jest.fn(async () => undefined),
    }

    const scope = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }

        if (key === Modules.PAYMENT) {
          return payment
        }

        if (key === Modules.WORKFLOW_ENGINE) {
          return workflowEngine
        }

        if (key === Modules.EVENT_BUS) {
          return eventBus
        }

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const req = {
      scope,
      params: { id: "cart_cod_1" },
      body: {},
      auth_context: { actor_id: "cus_1" },
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const next = jest.fn()
    const middleware = makeCheckoutPaymentWorkflowMiddleware(
      validateStoreCodPaymentAuthorizeWorkflow
    )

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "COUPON_INVALID",
        message: expect.stringContaining("Support Code:"),
        details: {},
        correlation_id: expect.any(String),
        error: {
          code: "COUPON_INVALID",
          message: "Coupon SAVE10 is no longer valid for this cart.",
          details: {},
          correlation_id: expect.any(String),
        },
      })
    )
  })

  it("integrity violation blocks order placement", async () => {
    const cart = makeCodCart()
    cart.grand_total = -1
    cart.total = -1
    cart.payment_collection.payment_sessions = [
      {
        id: "payses_cod_4",
        provider_id: "pp_cod_cod",
        status: "authorized",
      },
    ]

    const query = {
      graph: jest.fn(async ({ entity }: { entity: string }) => {
        if (entity === "cart") {
          return { data: [cart] }
        }

        if (entity === "shipping_option") {
          return {
            data: [
              {
                id: "so_cod",
                name: "Cash on Delivery",
                metadata: { payment_type: "cod" },
              },
            ],
          }
        }

        return { data: [] }
      }),
    }

    const payment = {
      deletePaymentSession: jest.fn(async () => undefined),
      createPaymentSession: jest.fn(async () => undefined),
      authorizePaymentSession: jest.fn(async () => undefined),
    }

    const eventBus = {
      emit: jest.fn(async () => undefined),
    }

    const scope = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }

        if (key === Modules.PAYMENT) {
          return payment
        }

        if (key === Modules.EVENT_BUS) {
          return eventBus
        }

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const req = {
      scope,
      params: { id: "cart_cod_1" },
      body: {},
      auth_context: { actor_id: "cus_1" },
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const next = jest.fn()
    const middleware = makeCheckoutPaymentWorkflowMiddleware(
      validateStoreCodPaymentAuthorizeWorkflow
    )

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PRICE_INTEGRITY_VIOLATION",
        message: expect.stringContaining("Support Code:"),
        details: {},
        correlation_id: expect.any(String),
        error: {
          code: "PRICE_INTEGRITY_VIOLATION",
          message: "Price integrity violation: grand_total cannot be negative.",
          details: {},
          correlation_id: expect.any(String),
        },
      })
    )

    const snapshot = getMetricsSnapshot()
    const failureCounter = snapshot.counters.find(
      (entry) =>
        entry.name === "workflow.order_place.failure_total" &&
        entry.labels?.error_code === "PRICE_INTEGRITY_VIOLATION"
    )
    expect(failureCounter).toEqual(
      expect.objectContaining({
        labels: expect.objectContaining({
          workflow: "order_place",
          result: "failure",
          error_code: "PRICE_INTEGRITY_VIOLATION",
        }),
        value: 1,
      })
    )
  })

  it("order placement validation remains idempotent across repeated calls", async () => {
    const cart = makeCodCartWithCoupon()
    cart.payment_collection.payment_sessions = [
      {
        id: "payses_cod_5",
        provider_id: "pp_cod_cod",
        status: "authorized",
      },
    ]

    const query = {
      graph: jest.fn(async ({ entity }: { entity: string }) => {
        if (entity === "cart") {
          return { data: [cart] }
        }

        if (entity === "shipping_option") {
          return {
            data: [
              {
                id: "so_cod",
                name: "Cash on Delivery",
                metadata: { payment_type: "cod" },
              },
            ],
          }
        }

        if (entity === "promotion") {
          return {
            data: [
              {
                id: "promo_1",
                code: "SAVE10",
                limit: 100,
                used: 10,
                campaign: { budget: { limit: null, used: 0 } },
              },
            ],
          }
        }

        return { data: [] }
      }),
    }

    const workflowEngine = {
      run: jest.fn(async () => undefined),
    }

    const payment = {
      deletePaymentSession: jest.fn(async () => undefined),
      createPaymentSession: jest.fn(async () => undefined),
      authorizePaymentSession: jest.fn(async () => undefined),
    }

    const eventBus = {
      emit: jest.fn(async () => undefined),
    }

    const scope = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) {
          return query
        }

        if (key === Modules.PAYMENT) {
          return payment
        }

        if (key === Modules.WORKFLOW_ENGINE) {
          return workflowEngine
        }

        if (key === Modules.EVENT_BUS) {
          return eventBus
        }

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const req = {
      scope,
      params: { id: "cart_cod_1" },
      body: {},
      auth_context: { actor_id: "cus_1" },
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const next = jest.fn()
    const middleware = makeCheckoutPaymentWorkflowMiddleware(
      validateStoreCodPaymentAuthorizeWorkflow
    )

    await middleware(req, res, next)
    await middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(2)
    expect(res.status).not.toHaveBeenCalled()
    expect(cart.discount_codes).toEqual([{ code: "SAVE10", is_automatic: false }])
    expect(workflowEngine.run).toHaveBeenCalledTimes(2)
  })
})
