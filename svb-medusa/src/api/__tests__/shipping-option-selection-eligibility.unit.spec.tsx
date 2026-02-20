import {
  makeShippingOptionEligibilityMiddleware,
  validateStoreSelectShippingOptionEligibilityBody,
} from "../middlewares"

function makeScope(params: {
  cart: Record<string, unknown>
  shippingOption: Record<string, unknown>
}) {
  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) => {
      if (entity === "cart") {
        return { data: [params.cart] }
      }

      if (entity === "shipping_option") {
        return { data: [params.shippingOption] }
      }

      return { data: [] }
    }),
  }

  return {
    resolve: (key: string) => {
      if (key === "query") {
        return query
      }

      throw new Error(`Unknown container key: ${key}`)
    },
  }
}

describe("cart shipping-option selection eligibility", () => {
  it("selecting COD succeeds when all items are cod_eligible=true", async () => {
    const scope = makeScope({
      cart: {
        id: "cart_1",
        items: [
          { variant: { metadata: { cod_eligible: true } } },
          { variant: { metadata: { cod_eligible: true } } },
        ],
      },
      shippingOption: {
        id: "so_cod",
        name: "Cash on Delivery",
        metadata: { payment_type: "cod" },
      },
    })

    const req = {
      scope,
      params: { id: "cart_1" },
      body: { option_id: "so_cod" },
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const next = jest.fn()
    const middleware = makeShippingOptionEligibilityMiddleware(
      validateStoreSelectShippingOptionEligibilityBody
    )

    await middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  it("selecting COD fails if any cart item has cod_eligible=false", async () => {
    const scope = makeScope({
      cart: {
        id: "cart_2",
        items: [
          { variant: { metadata: { cod_eligible: true } } },
          { variant: { metadata: { cod_eligible: false } } },
        ],
      },
      shippingOption: {
        id: "so_cod",
        name: "Cash on Delivery",
        metadata: { payment_type: "cod" },
      },
    })

    const req = {
      scope,
      params: { id: "cart_2" },
      body: { option_id: "so_cod" },
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const next = jest.fn()
    const middleware = makeShippingOptionEligibilityMiddleware(
      validateStoreSelectShippingOptionEligibilityBody
    )

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "SHIPPING_OPTION_INELIGIBLE",
        message:
          "COD allowed only when all cart variants have metadata.cod_eligible=true",
        details: {},
        correlation_id: expect.any(String),
      },
    })
  })
})
