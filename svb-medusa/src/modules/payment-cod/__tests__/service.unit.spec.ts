import { PaymentSessionStatus } from "@medusajs/framework/utils"
import CodPaymentProviderService from "../service"

describe("COD payment provider", () => {
  const provider = new CodPaymentProviderService({}, {})

  it("initializes and authorizes a COD session", async () => {
    const initiated = await provider.initiatePayment({
      amount: 1299,
      currency_code: "inr",
      data: {
        cart_id: "cart_01",
      },
    })

    expect(initiated.status).toBe(PaymentSessionStatus.PENDING)
    expect(typeof initiated.id).toBe("string")
    expect(initiated.data?.cod_state).toBe("session_created")

    const authorized = await provider.authorizePayment({
      data: initiated.data,
    })

    expect(authorized.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(authorized.data?.cod_state).toBe("authorized")
    expect(typeof authorized.data?.authorized_at).toBe("string")
  })

  it("authorizes idempotently", async () => {
    const first = await provider.authorizePayment({
      data: {
        cod_state: "authorized",
        cod_reference: "COD-idempotent",
        authorized_at: "2026-02-18T00:00:00.000Z",
      },
    })

    const second = await provider.authorizePayment({
      data: first.data,
    })

    expect(second.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(second.data).toEqual(first.data)
  })

  it("captures an authorized COD payment", async () => {
    const captured = await provider.capturePayment({
      data: {
        cod_state: "authorized",
        cod_reference: "COD-capture",
      },
    })

    expect(captured.data?.cod_state).toBe("captured")
    expect(typeof captured.data?.captured_at).toBe("string")
  })

  it("records refund state for COD", async () => {
    const refunded = await provider.refundPayment({
      amount: 500,
      data: {
        cod_state: "captured",
        cod_reference: "COD-refund",
      },
      context: {
        idempotency_key: "refund_order_01",
      },
    })

    expect(refunded.data?.cod_state).toBe("refunded")
    expect(typeof refunded.data?.refunded_at).toBe("string")
    expect(Array.isArray(refunded.data?.refund_records)).toBe(true)
    expect(refunded.data?.refund_records).toHaveLength(1)
  })
})
