import { buildShipmentContract } from "../build-shipment-contract"

describe("buildShipmentContract", () => {
  it("builds one package with combined items for a 2-item SMALL-only order", () => {
    const order = {
      id: "order_01",
      display_id: 1001,
      shipping_address: {
        first_name: "Prash",
        last_name: "K",
        phone: "9999999999",
        address_1: "Street 1",
        city: "Chennai",
        province: "TN",
        postal_code: "600001",
        country_code: "IN",
      },
      items: [
        {
          id: "item_1",
          title: "Swift Plus Ball",
          quantity: 1,
          variant: {
            id: "var_1",
            sku: "SVB-CRB-SWFP-WHT-P01",
            metadata: {
              weight_grams: 160,
              dimensions_cm: { l: 10, w: 6, h: 4 },
              shipping_class: "SMALL",
            },
          },
        },
        {
          id: "item_2",
          title: "Blitz Plus Ball",
          quantity: 2,
          variant: {
            id: "var_2",
            sku: "SVB-CRB-BLTZP-RED-P12",
            metadata: {
              weight_grams: 180,
              dimensions_cm: { l: 12, w: 7, h: 5 },
              shipping_class: "SMALL",
            },
          },
        },
      ],
      payment_collections: [
        {
          payments: [{ provider_id: "pp_system_default", amount: 1999 }],
        },
      ],
      total: 1999,
    }

    const contract = buildShipmentContract(order)

    expect(contract.order_id).toBe("order_01")
    expect(contract.pickup_location_code).toBe("WH-MRT-01")
    expect(contract.packages).toHaveLength(1)
    expect(contract.packages[0]).toEqual({
      weight_grams: 520,
      dimensions_cm: { l: 12, w: 7, h: 14 },
      items: [
        { sku: "SVB-CRB-SWFP-WHT-P01", qty: 1, name: "Swift Plus Ball" },
        { sku: "SVB-CRB-BLTZP-RED-P12", qty: 2, name: "Blitz Plus Ball" },
      ],
    })
    expect(contract.cod).toEqual({ enabled: false, amount: 0 })
    expect(contract.invoice_ref).toBe("1001")
  })

  it("sets cod.enabled=true and amount for COD orders", () => {
    const order = {
      id: "order_cod_01",
      items: [
        {
          id: "item_cod_1",
          title: "Swift Plus Ball",
          quantity: 1,
          variant: {
            id: "var_cod_1",
            sku: "SVB-CRB-SWFP-WHT-P01",
            metadata: {
              weight_grams: 160,
              dimensions_cm: { l: 10, w: 6, h: 4 },
              shipping_class: "SMALL",
            },
          },
        },
      ],
      payment_collections: [
        {
          payments: [{ provider_id: "pp_cod_cod", amount: 1499 }],
        },
      ],
      total: 1499,
    }

    const contract = buildShipmentContract(order)

    expect(contract.cod).toEqual({ enabled: true, amount: 1499 })
  })

  it("throws MISSING_LOGISTICS_METADATA when any item misses dimensions/weight", () => {
    const order = {
      id: "order_missing_logistics",
      items: [
        {
          id: "item_1",
          title: "Swift Plus Ball",
          quantity: 1,
          variant: {
            id: "var_1",
            sku: "SVB-CRB-SWFP-WHT-P01",
            metadata: {
              dimensions_cm: { l: 10, w: 6, h: 4 },
              shipping_class: "SMALL",
            },
          },
        },
      ],
      payment_collections: [
        {
          payments: [{ provider_id: "pp_system_default", amount: 999 }],
        },
      ],
      total: 999,
    }

    try {
      buildShipmentContract(order)
      throw new Error("Expected buildShipmentContract to throw")
    } catch (error) {
      expect((error as { code?: string }).code).toBe("MISSING_LOGISTICS_METADATA")
    }
  })
})
