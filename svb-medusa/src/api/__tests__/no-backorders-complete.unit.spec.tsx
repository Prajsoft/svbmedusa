import {
  makeInventoryValidationMiddleware,
  validateStoreAddToCartBody,
  validateStoreCompleteCartBody,
} from "../middlewares"

describe("no-backorders final gate on cart completion", () => {
  it("fails completion if stock drops to 0 after add, with no order/reservation side effects", async () => {
    let availableQuantity = 1
    const cart = {
      id: "cart_1",
      sales_channel_id: "sc_1",
      items: [] as Array<{ id: string; variant_id: string; quantity: number }>,
    }

    const query = {
      graph: jest.fn(async ({ entity }: { entity: string }) => {
        if (entity === "cart") {
          return { data: [cart] }
        }

        if (entity === "variant") {
          return {
            data: [
              {
                id: "variant_1",
                sku: "SVB-CRB-SWFP-WHT-P01",
                inventory_items: [
                  {
                    inventory_item_id: "iitem_1",
                    required_quantity: 1,
                    inventory: {
                      location_levels: [
                        {
                          location_id: "sloc_1",
                          stock_locations: {
                            id: "sloc_1",
                            name: "WH-MRT-01",
                            sales_channels: [{ id: "sc_1" }],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          }
        }

        return { data: [] }
      }),
    }

    const inventory = {
      retrieveAvailableQuantity: jest.fn(async () => availableQuantity),
    }

    const scope = {
      resolve: (key: string) => {
        if (key === "query") {
          return query
        }

        if (key === "inventory") {
          return inventory
        }

        throw new Error(`Unknown container key: ${key}`)
      },
    }

    const addReq = {
      scope,
      params: { id: "cart_1" },
      body: { variant_id: "variant_1", quantity: 1 },
    } as any

    await expect(validateStoreAddToCartBody(addReq)).resolves.toBeUndefined()

    cart.items = [{ id: "line_1", variant_id: "variant_1", quantity: 1 }]
    availableQuantity = 0

    const completeReq = {
      scope,
      params: { id: "cart_1" },
      body: {},
    } as any

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    const orderCreated = jest.fn()
    const reservationsApplied = jest.fn()
    const next = jest.fn(() => {
      orderCreated()
      reservationsApplied()
    })

    const middleware = makeInventoryValidationMiddleware(validateStoreCompleteCartBody)
    await middleware(completeReq, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(orderCreated).not.toHaveBeenCalled()
    expect(reservationsApplied).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "OUT_OF_STOCK",
        message: expect.stringContaining("Support Code:"),
        details: {},
        correlation_id: expect.any(String),
        error: {
          code: "OUT_OF_STOCK",
          message: "Insufficient inventory for SKU SVB-CRB-SWFP-WHT-P01 at WH-MRT-01",
          details: {},
          correlation_id: expect.any(String),
        },
      })
    )
  })
})
