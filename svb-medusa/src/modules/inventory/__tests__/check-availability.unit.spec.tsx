import {
  checkAvailabilityForAddToCart,
  checkAvailabilityForUpdateCartLineItem,
  OutOfStockError,
} from "../check-availability"

type MockScope = {
  resolve: (key: string) => any
}

function createScope(params: {
  cart: Record<string, unknown>
  variant: Record<string, unknown>
  availableQuantity: number
}): MockScope {
  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) => {
      if (entity === "cart") {
        return { data: [params.cart] }
      }

      if (entity === "variant") {
        return { data: [params.variant] }
      }

      return { data: [] }
    }),
  }

  const inventory = {
    retrieveAvailableQuantity: jest.fn(async () => params.availableQuantity),
  }

  return {
    resolve: (key: string) => {
      if (key === "query") {
        return query
      }

      if (key === "inventory") {
        return inventory
      }

      throw new Error(`Unknown key ${key}`)
    },
  }
}

function baseVariant() {
  return {
    id: "variant_1",
    sku: "SVB-CRB-SWFP-WHT-P01",
    manage_inventory: true,
    allow_backorder: false,
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
  }
}

describe("no-backorders availability checks", () => {
  it("fails add-to-cart when available inventory is 0", async () => {
    const scope = createScope({
      cart: {
        id: "cart_1",
        sales_channel_id: "sc_1",
        items: [],
      },
      variant: baseVariant(),
      availableQuantity: 0,
    })

    await expect(
      checkAvailabilityForAddToCart(scope, "cart_1", "variant_1", 1)
    ).rejects.toMatchObject<Partial<OutOfStockError>>({
      code: "OUT_OF_STOCK",
      message: "Insufficient inventory for SKU SVB-CRB-SWFP-WHT-P01 at WH-MRT-01",
    })
  })

  it("fails line-item update when increasing quantity beyond available", async () => {
    const scope = createScope({
      cart: {
        id: "cart_1",
        sales_channel_id: "sc_1",
        items: [
          {
            id: "line_1",
            variant_id: "variant_1",
            quantity: 1,
          },
        ],
      },
      variant: baseVariant(),
      availableQuantity: 2,
    })

    await expect(
      checkAvailabilityForUpdateCartLineItem(scope, "cart_1", "line_1", 3)
    ).rejects.toMatchObject<Partial<OutOfStockError>>({
      code: "OUT_OF_STOCK",
      message: "Insufficient inventory for SKU SVB-CRB-SWFP-WHT-P01 at WH-MRT-01",
    })
  })

  it("allows add-to-cart when requested quantity is within available", async () => {
    const scope = createScope({
      cart: {
        id: "cart_1",
        sales_channel_id: "sc_1",
        items: [
          {
            id: "line_1",
            variant_id: "variant_1",
            quantity: 1,
          },
        ],
      },
      variant: baseVariant(),
      availableQuantity: 2,
    })

    await expect(
      checkAvailabilityForAddToCart(scope, "cart_1", "variant_1", 1)
    ).resolves.toBeUndefined()
  })

  it("allows add-to-cart when variant does not manage inventory", async () => {
    const scope = createScope({
      cart: {
        id: "cart_1",
        sales_channel_id: "sc_1",
        items: [],
      },
      variant: {
        ...baseVariant(),
        manage_inventory: false,
      },
      availableQuantity: 0,
    })

    await expect(
      checkAvailabilityForAddToCart(scope, "cart_1", "variant_1", 1)
    ).resolves.toBeUndefined()
  })

  it("allows add-to-cart when variant allows backorder", async () => {
    const scope = createScope({
      cart: {
        id: "cart_1",
        sales_channel_id: "sc_1",
        items: [],
      },
      variant: {
        ...baseVariant(),
        allow_backorder: true,
      },
      availableQuantity: 0,
    })

    await expect(
      checkAvailabilityForAddToCart(scope, "cart_1", "variant_1", 1)
    ).resolves.toBeUndefined()
  })
})
