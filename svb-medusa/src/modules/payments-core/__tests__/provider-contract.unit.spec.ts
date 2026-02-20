import { PaymentErrorCode, PaymentStatus } from "../../../../payments/types"
import {
  PAYMENT_PROVIDER_CAPABILITIES,
  getProviderCapabilities,
  providerCapabilitiesMatrixSchema,
  authorizePaymentInputSchema,
  initiatePaymentInputSchema,
  initiatePaymentOutputSchema,
  notSupportedResult,
  parseInitiatePaymentInput,
  parseProviderMappedError,
  paymentOperationOutputSchema,
  providerMappedErrorSchema,
  type IPaymentProvider,
} from "../../../../payments/provider"

const CORRELATION_ID = "8d87f803-9f60-45f1-8dcf-33a87f30f44f"

describe("payments/provider contract", () => {
  it("validates initiate input and normalizes currency", () => {
    const parsed = parseInitiatePaymentInput({
      payment_session_id: "ps_123",
      cart_id: "cart_123",
      amount: 4999,
      currency: "inr",
      customer: {
        name: "Prash",
        email: "prash@example.com",
      },
      correlation_id: CORRELATION_ID,
    })

    expect(parsed.currency).toBe("INR")
    expect(parsed.amount).toBe(4999)
  })

  it("rejects initiate input without order_id/cart_id", () => {
    const result = initiatePaymentInputSchema.safeParse({
      payment_session_id: "ps_123",
      amount: 4999,
      currency: "INR",
      correlation_id: CORRELATION_ID,
    })

    expect(result.success).toBe(false)
  })

  it("rejects initiate input with unknown keys (strict DTO)", () => {
    const result = initiatePaymentInputSchema.safeParse({
      payment_session_id: "ps_123",
      order_id: "order_123",
      amount: 4999,
      currency: "INR",
      correlation_id: CORRELATION_ID,
      upstream_status: "created",
    })

    expect(result.success).toBe(false)
  })

  it("validates authorize input with internal ids and provider payload", () => {
    const result = authorizePaymentInputSchema.safeParse({
      payment_session_id: "ps_123",
      order_id: "order_123",
      provider_payload: {
        razorpay_payment_id: "pay_123",
        razorpay_order_id: "order_abc",
        razorpay_signature: "sig_1",
      },
      provider_payment_id: "pay_123",
      provider_order_id: "order_abc",
      provider_signature: "sig_1",
      correlation_id: CORRELATION_ID,
    })

    expect(result.success).toBe(true)
  })

  it("enforces internal PaymentStatus only in provider outputs", () => {
    const success = initiatePaymentOutputSchema.safeParse({
      status: PaymentStatus.PENDING,
      provider_session_data: {
        razorpay_order_id: "order_abc",
      },
      presentation_data: {
        type: "razorpay",
        keyId: "rzp_test_x",
        orderId: "order_abc",
        amount: 4999,
        currency: "INR",
      },
      provider_refs: {
        provider_order_id: "order_abc",
      },
      correlation_id: CORRELATION_ID,
    })

    const failure = paymentOperationOutputSchema.safeParse({
      status: "CREATED",
      provider_session_data: {},
      provider_refs: {},
      correlation_id: CORRELATION_ID,
    })

    expect(success.success).toBe(true)
    expect(failure.success).toBe(false)
  })

  it("enforces internal PaymentErrorCode only and blocks raw upstream code leaks", () => {
    const ok = parseProviderMappedError({
      code: PaymentErrorCode.RATE_LIMITED,
      message: "Provider rate limit hit",
      details: {
        endpoint: "/v1/orders",
      },
      correlation_id: CORRELATION_ID,
    })

    const invalid = providerMappedErrorSchema.safeParse({
      code: "RAZORPAY_HTTP_429",
      message: "raw upstream code",
      details: {},
      correlation_id: CORRELATION_ID,
    })

    expect(ok.code).toBe(PaymentErrorCode.RATE_LIMITED)
    expect(invalid.success).toBe(false)
  })

  it("type-checks IPaymentProvider contract and supports NOT_SUPPORTED behavior", async () => {
    const provider: IPaymentProvider = {
      async initiatePayment(input) {
        return {
          ok: true,
          data: {
            status: PaymentStatus.PENDING,
            provider_session_data: {
              provider: "mock",
              payment_session_id: input.payment_session_id,
            },
            presentation_data: {
              type: "razorpay",
              keyId: "rzp_test_mock",
              orderId: "order_mock_1",
              amount: input.amount,
              currency: input.currency,
            },
            provider_refs: {},
            correlation_id: input.correlation_id,
          },
        }
      },
      async authorizePayment(input) {
        return {
          ok: true,
          data: {
            status: PaymentStatus.AUTHORIZED,
            provider_session_data: {
              provider_payload: input.provider_payload,
            },
            provider_refs: {
              provider_payment_id: input.provider_payment_id,
              provider_order_id: input.provider_order_id,
            },
            correlation_id: input.correlation_id,
          },
        }
      },
      async capturePayment(input) {
        return notSupportedResult({
          message: "manual capture is disabled for this provider",
          correlation_id: input.correlation_id,
        })
      },
      async refundPayment(input) {
        return notSupportedResult({
          message: "refund not supported",
          correlation_id: input.correlation_id,
        })
      },
      async cancelPayment(input) {
        return {
          ok: true,
          data: {
            status: PaymentStatus.CANCELLED,
            provider_session_data: {},
            provider_refs: {},
            correlation_id: input.correlation_id,
          },
        }
      },
      getCapabilities() {
        return {
          supportsRefunds: false,
          supportsWebhooks: true,
          supportsManualCapture: false,
        }
      },
    }

    const initiated = await provider.initiatePayment({
      payment_session_id: "ps_123",
      order_id: "order_123",
      amount: 4999,
      currency: "INR",
      correlation_id: CORRELATION_ID,
    })
    const captured = await provider.capturePayment({
      payment_session_id: "ps_123",
      order_id: "order_123",
      correlation_id: CORRELATION_ID,
    })

    expect(initiated.ok).toBe(true)
    expect(provider.getCapabilities().supportsWebhooks).toBe(true)
    expect(captured.ok).toBe(false)
    if (!captured.ok) {
      expect(captured.error.code).toBe(PaymentErrorCode.NOT_SUPPORTED)
    }
  })

  it("validates capabilities matrix and lookup", () => {
    const parsed = providerCapabilitiesMatrixSchema.parse(
      PAYMENT_PROVIDER_CAPABILITIES
    )

    expect(parsed.razorpay.supportsWebhooks).toBe(true)
    expect(parsed.cod.supportsManualCapture).toBe(false)
    expect(getProviderCapabilities("razorpay")?.supportsRefunds).toBe(true)
    expect(getProviderCapabilities("unknown")).toBeNull()
  })
})
