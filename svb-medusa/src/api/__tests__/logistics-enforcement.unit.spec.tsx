import {
  makeLogisticsValidationMiddleware,
  validateStoreSelectShippingMethodBody,
} from "../middlewares"

function makeScope(cart: Record<string, unknown>) {
  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) => {
      if (entity === "cart") {
        return { data: [cart] }
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

describe("logistics metadata enforcement", () => {
  it("prevents shipping selection when a cart item is missing logistics metadata", async () => {
    const scope = makeScope({
      id: "cart_1",
      items: [
        {
          id: "line_1",
          variant: {
            id: "variant_1",
            sku: "SVB-CRB-SWFP-WHT-P01",
            metadata: {
              dimensions_cm: { l: 10, w: 5, h: 5 },
              shipping_class: "SMALL",
            },
          },
        },
      ],
    })

    const req = {
      scope,
      params: { id: "cart_1" },
      body: { option_id: "so_1" },
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const next = jest.fn()
    const middleware = makeLogisticsValidationMiddleware(
      validateStoreSelectShippingMethodBody
    )

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "MISSING_LOGISTICS_METADATA",
        message:
          "SKU SVB-CRB-SWFP-WHT-P01 is missing logistics metadata: weight_grams",
        details: {},
        correlation_id: expect.any(String),
      },
    })
  })

  it("allows shipping selection when all cart items have valid logistics metadata", async () => {
    const scope = makeScope({
      id: "cart_1",
      items: [
        {
          id: "line_1",
          variant: {
            id: "variant_1",
            sku: "SVB-CRB-SWFP-WHT-P01",
            metadata: {
              weight_grams: 180,
              dimensions_cm: { l: 10, w: 5, h: 5 },
              shipping_class: "MEDIUM",
            },
          },
        },
      ],
    })

    const req = {
      scope,
      params: { id: "cart_1" },
      body: { option_id: "so_1" },
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const next = jest.fn()
    const middleware = makeLogisticsValidationMiddleware(
      validateStoreSelectShippingMethodBody
    )

    await middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })
})
