import { getPaymentPresentationData } from "../presentation-data"

describe("payment presentation data", () => {
  it("builds safe Razorpay presentation data without secret leakage", () => {
    const presentation = getPaymentPresentationData(
      "pp_razorpay_razorpay",
      {
        razorpay_order_id: "order_test_1",
        razorpay_key_id: "rzp_test_key_1",
        amount: 1499,
        currency_code: "INR",
        razorpay_key_secret: "secret_should_not_leak",
        authorization: "Bearer should_not_leak",
      }
    )

    expect(presentation).toEqual({
      type: "razorpay",
      keyId: "rzp_test_key_1",
      orderId: "order_test_1",
      amount: 1499,
      currency: "INR",
      prefill: undefined,
    })

    const serialized = JSON.stringify(presentation)
    expect(serialized).not.toContain("secret_should_not_leak")
    expect(serialized).not.toContain("authorization")
  })

  it("includes prefill when customer data is available", () => {
    const presentation = getPaymentPresentationData(
      "pp_razorpay_razorpay",
      {
        razorpay_order_id: "order_test_2",
        razorpay_key_id: "rzp_test_key_2",
        amount: 2500,
        currency_code: "INR",
      },
      {
        customer: {
          first_name: "Prash",
          last_name: "Kumar",
          email: "prash@example.com",
          phone: "9876543210",
        },
      }
    )

    expect(presentation).toEqual({
      type: "razorpay",
      keyId: "rzp_test_key_2",
      orderId: "order_test_2",
      amount: 2500,
      currency: "INR",
      prefill: {
        name: "Prash Kumar",
        email: "prash@example.com",
        phone: "9876543210",
      },
    })
  })

  it("maps Stripe presentation data for future provider support", () => {
    const presentation = getPaymentPresentationData("pp_stripe_stripe", {
      client_secret: "pi_client_secret_123",
      secret: "should_not_leak",
    })

    expect(presentation).toEqual({
      type: "stripe",
      clientSecret: "pi_client_secret_123",
    })
  })
})
