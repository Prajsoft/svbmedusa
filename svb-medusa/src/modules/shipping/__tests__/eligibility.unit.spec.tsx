import {
  filterShippingOptionsByEligibility,
  getCartShippingEligibility,
} from "../eligibility"

describe("shipping option eligibility", () => {
  const prepaid = {
    id: "so_prepaid",
    name: "Standard Prepaid",
    metadata: { payment_type: "prepaid" },
  }

  const cod = {
    id: "so_cod",
    name: "Cash on Delivery",
    metadata: { payment_type: "cod" },
  }

  it("cart with cod_eligible=true on all items shows prepaid + COD", () => {
    const cart = {
      id: "cart_1",
      items: [
        { variant: { metadata: { cod_eligible: true } } },
        { variant: { metadata: { cod_eligible: true } } },
      ],
    }

    const eligibility = getCartShippingEligibility(cart)
    const result = filterShippingOptionsByEligibility([prepaid, cod], eligibility)

    expect(result.map((o) => o.id)).toEqual(["so_prepaid", "so_cod"])
  })

  it("if any item has cod_eligible=false, COD is filtered out", () => {
    const cart = {
      id: "cart_2",
      items: [
        { variant: { metadata: { cod_eligible: true } } },
        { variant: { metadata: { cod_eligible: false } } },
      ],
    }

    const eligibility = getCartShippingEligibility(cart)
    const result = filterShippingOptionsByEligibility([prepaid, cod], eligibility)

    expect(result.map((o) => o.id)).toEqual(["so_prepaid"])
  })
})
