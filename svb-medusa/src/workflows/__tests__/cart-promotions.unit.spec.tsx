import { updateCartPromotionsWorkflowId } from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  Modules,
  PromotionActions,
} from "@medusajs/framework/utils"
import {
  cartApplyCouponWorkflow,
  CartCouponWorkflowError,
} from "../cart_apply_coupon"
import { cartRemoveCouponWorkflow } from "../cart_remove_coupon"
import {
  __resetMetricsForTests,
  getMetricsSnapshot,
} from "../../modules/observability/metrics"

type CartState = {
  id: string
  coupon_code: string | null
  discount_codes: Array<{ code: string; is_automatic?: boolean }>
  promotions: Array<{ code: string; is_automatic?: boolean }>
  total: number
  subtotal: number
  discount_total: number
  shipping_total: number
  original_shipping_total: number
  items: Array<{ id: string; subtotal: number; discount_total: number }>
  shipping_methods: Array<{
    id: string
    total: number
    subtotal: number
    discount_total: number
    original_total: number
    original_subtotal: number
  }>
}

function makeCart(overrides: Partial<CartState> = {}): CartState {
  return {
    id: "cart_01",
    coupon_code: null,
    discount_codes: [],
    promotions: [],
    total: 2000,
    subtotal: 2000,
    discount_total: 0,
    shipping_total: 0,
    original_shipping_total: 0,
    items: [{ id: "line_01", subtotal: 2000, discount_total: 0 }],
    shipping_methods: [],
    ...overrides,
  }
}

function cloneCart(cart: CartState): CartState {
  return JSON.parse(JSON.stringify(cart)) as CartState
}

function applyCouponToCartState(cart: CartState, code: string): void {
  if (!cart.discount_codes.some((entry) => entry.code === code)) {
    cart.discount_codes.push({ code })
  }

  cart.coupon_code = code
  cart.discount_total = 200
  cart.total = 1800
  cart.items = cart.items.map((item) => ({
    ...item,
    discount_total: 200,
  }))
}

function removeCouponFromCartState(cart: CartState, code: string): void {
  cart.discount_codes = cart.discount_codes.filter((entry) => entry.code !== code)
  if (cart.coupon_code === code) {
    cart.coupon_code = null
  }

  cart.discount_total = 0
  cart.total = 2000
  cart.items = cart.items.map((item) => ({
    ...item,
    discount_total: 0,
  }))
}

function makeScope(cart: CartState) {
  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) => {
      if (entity === "cart") {
        return { data: [cloneCart(cart)] }
      }

      return { data: [] }
    }),
  }

  const workflowEngine = {
    run: jest.fn(
      async (
        workflowId: string,
        {
          input,
        }: {
          input: {
            cart_id: string
            promo_codes: string[]
            action: string
            force_refresh_payment_collection: boolean
          }
        }
      ) => {
        if (workflowId !== updateCartPromotionsWorkflowId) {
          throw new Error(`Unexpected workflow id: ${workflowId}`)
        }

        for (const code of input.promo_codes) {
          if (input.action === PromotionActions.ADD) {
            applyCouponToCartState(cart, code)
          }

          if (input.action === PromotionActions.REMOVE) {
            removeCouponFromCartState(cart, code)
          }
        }
      }
    ),
  }

  const eventBus = {
    emit: jest.fn(async () => undefined),
  }

  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) {
        return query
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

  return {
    scope,
    query,
    workflowEngine,
    eventBus,
    cart,
  }
}

describe("cart promotions workflows", () => {
  beforeEach(() => {
    __resetMetricsForTests()
  })

  it("valid coupon applies successfully", async () => {
    const harness = makeScope(makeCart())

    const result = await cartApplyCouponWorkflow(harness.scope as any, {
      cart_id: "cart_01",
      code: "save10",
    })

    expect(result.promo_code).toBe("SAVE10")
    expect(result.cart.discount_codes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SAVE10" })])
    )
    expect(harness.workflowEngine.run).toHaveBeenCalledWith(
      updateCartPromotionsWorkflowId,
      expect.objectContaining({
        input: expect.objectContaining({
          action: PromotionActions.ADD,
          promo_codes: ["SAVE10"],
          cart_id: "cart_01",
        }),
      })
    )
    expect(harness.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "promotion.applied",
        data: expect.objectContaining({
          cart_id: "cart_01",
          promo_code: "SAVE10",
          correlation_id: expect.any(String),
        }),
      })
    )

    const snapshot = getMetricsSnapshot()
    const successCounter = snapshot.counters.find(
      (entry) => entry.name === "workflow.coupon_apply.success_total"
    )
    expect(successCounter).toEqual(
      expect.objectContaining({
        labels: expect.objectContaining({
          workflow: "coupon_apply",
          result: "success",
        }),
        value: 1,
      })
    )
  })

  it("second manual coupon is rejected with COUPON_STACKING_NOT_ALLOWED", async () => {
    const harness = makeScope(
      makeCart({
        coupon_code: "SAVE10",
        discount_codes: [{ code: "SAVE10" }],
      })
    )

    await expect(
      cartApplyCouponWorkflow(harness.scope as any, {
        cart_id: "cart_01",
        code: "save20",
      })
    ).rejects.toMatchObject({
      code: "COUPON_STACKING_NOT_ALLOWED",
    } satisfies Pick<CartCouponWorkflowError, "code">)

    expect(harness.workflowEngine.run).not.toHaveBeenCalled()

    const snapshot = getMetricsSnapshot()
    const failureCounter = snapshot.counters.find(
      (entry) =>
        entry.name === "workflow.coupon_apply.failure_total" &&
        entry.labels?.error_code === "COUPON_STACKING_NOT_ALLOWED"
    )
    expect(failureCounter).toEqual(
      expect.objectContaining({
        labels: expect.objectContaining({
          workflow: "coupon_apply",
          result: "failure",
          error_code: "COUPON_STACKING_NOT_ALLOWED",
        }),
        value: 1,
      })
    )
  })

  it("manual coupon is rejected when auto promo exists and auto+manual is disabled", async () => {
    const harness = makeScope(
      makeCart({
        promotions: [{ code: "AUTO10", is_automatic: true }],
      })
    )

    await expect(
      cartApplyCouponWorkflow(harness.scope as any, {
        cart_id: "cart_01",
        code: "save10",
      })
    ).rejects.toMatchObject({
      code: "COUPON_STACKING_NOT_ALLOWED",
    } satisfies Pick<CartCouponWorkflowError, "code">)

    expect(harness.workflowEngine.run).not.toHaveBeenCalled()
  })

  it("remove coupon works", async () => {
    const harness = makeScope(
      makeCart({
        coupon_code: "SAVE10",
        discount_codes: [{ code: "SAVE10" }],
        discount_total: 200,
        total: 1800,
        items: [{ id: "line_01", subtotal: 2000, discount_total: 200 }],
      })
    )

    const result = await cartRemoveCouponWorkflow(harness.scope as any, {
      cart_id: "cart_01",
      code: "save10",
    })

    expect(result.cart.discount_codes).toEqual([])
    expect(result.cart.coupon_code).toBeNull()
    expect(result.cart.discount_total).toBe(0)
    expect(harness.workflowEngine.run).toHaveBeenCalledWith(
      updateCartPromotionsWorkflowId,
      expect.objectContaining({
        input: expect.objectContaining({
          action: PromotionActions.REMOVE,
          promo_codes: ["SAVE10"],
          cart_id: "cart_01",
        }),
      })
    )
    expect(harness.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "promotion.removed",
        data: expect.objectContaining({
          cart_id: "cart_01",
          promo_code: "SAVE10",
          correlation_id: expect.any(String),
        }),
      })
    )
  })

  it("applying the same coupon twice does not duplicate it", async () => {
    const harness = makeScope(makeCart())

    await cartApplyCouponWorkflow(harness.scope as any, {
      cart_id: "cart_01",
      code: "SAVE10",
    })

    const second = await cartApplyCouponWorkflow(harness.scope as any, {
      cart_id: "cart_01",
      code: "save10",
    })

    const appliedCodes = second.cart.discount_codes.map((entry) => entry.code)
    expect(appliedCodes).toEqual(["SAVE10"])
    expect(harness.workflowEngine.run).toHaveBeenCalledTimes(1)
  })
})
