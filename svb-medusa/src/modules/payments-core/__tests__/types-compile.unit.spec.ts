import {
  PaymentErrorCode,
  PaymentStatus,
  type PaymentErrorShape,
  type PaymentEvent,
  type PaymentTransitionValidator,
} from "../../../../payments/types"

describe("payments/types static contracts", () => {
  it("exposes required status and error codes", () => {
    expect(PaymentStatus.PENDING).toBe("PENDING")
    expect(PaymentStatus.CANCELLED).toBe("CANCELLED")
    expect(PaymentErrorCode.STATE_TRANSITION_INVALID).toBe(
      "STATE_TRANSITION_INVALID"
    )
  })

  it("type-checks standard error and payment event shapes", () => {
    const errorShape: PaymentErrorShape = {
      code: PaymentErrorCode.VALIDATION_ERROR,
      message: "invalid",
      details: {
        field: "amount",
      },
      correlation_id: "corr_types_1",
    }

    const paymentEvent: PaymentEvent = {
      provider: "razorpay",
      event_id: "evt_1",
      event_type: "payment.captured",
      provider_payment_id: "pay_1",
      provider_order_id: "order_1",
      status_mapped: PaymentStatus.CAPTURED,
      raw_status: "captured",
      occurred_at: new Date().toISOString(),
      payload_sanitized: {
        sample: true,
      },
    }

    const transitionValidator: PaymentTransitionValidator = (
      _current,
      _next
    ) => true

    expect(errorShape.code).toBe("VALIDATION_ERROR")
    expect(paymentEvent.status_mapped).toBe("CAPTURED")
    expect(transitionValidator(PaymentStatus.PENDING, PaymentStatus.AUTHORIZED)).toBe(
      true
    )
  })
})
