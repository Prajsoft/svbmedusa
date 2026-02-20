import { PaymentErrorCode } from "../../../../payments/types"
import { PaymentProviderError } from "../../payments-core/contracts"
import { RazorpayContractProvider } from "../contract-provider"

function makeProvider(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    initiatePayment: jest.fn(async () => ({
      status: "pending",
      data: {
        correlation_id: "11111111-1111-4111-8111-111111111111",
        payment_status: "PENDING",
        razorpay_order_id: "order_default_1",
        presentation_data: {
          type: "razorpay",
          keyId: "rzp_test_key",
          orderId: "order_default_1",
          amount: 1000,
          currency: "INR",
        },
      },
    })),
    authorizePayment: jest.fn(async () => ({
      status: "authorized",
      data: {
        correlation_id: "22222222-2222-4222-8222-222222222222",
        payment_status: "AUTHORIZED",
      },
    })),
    capturePayment: jest.fn(async () => ({
      data: {},
    })),
    refundPayment: jest.fn(async () => ({
      data: {},
    })),
    cancelPayment: jest.fn(async () => ({
      data: {},
    })),
    ...overrides,
  } as any
}

const baseInitiateInput = {
  payment_session_id: "ps_contract_map_1",
  cart_id: "cart_contract_map_1",
  amount: 1499,
  currency: "INR",
  correlation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}

describe("RazorpayContractProvider error mapping", () => {
  it("maps 401/403 errors to AUTH_FAILED", async () => {
    const provider = new RazorpayContractProvider(
      makeProvider({
        initiatePayment: jest.fn(async () => {
          throw new PaymentProviderError({
            code: "RAZORPAY_AUTH_FAILED",
            message: "auth failed",
            correlation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            http_status: 401,
          })
        }),
      })
    )

    const result = await provider.initiatePayment(baseInitiateInput as any)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(PaymentErrorCode.AUTH_FAILED)
    }
  })

  it("maps 429 errors to RATE_LIMITED", async () => {
    const provider = new RazorpayContractProvider(
      makeProvider({
        initiatePayment: jest.fn(async () => {
          throw new PaymentProviderError({
            code: "RAZORPAY_RATE_LIMIT",
            message: "rate limit",
            correlation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            http_status: 429,
          })
        }),
      })
    )

    const result = await provider.initiatePayment(baseInitiateInput as any)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(PaymentErrorCode.RATE_LIMITED)
    }
  })

  it("maps 5xx and network failures to UPSTREAM_ERROR", async () => {
    const upstreamProvider = new RazorpayContractProvider(
      makeProvider({
        initiatePayment: jest.fn(async () => {
          throw new PaymentProviderError({
            code: "SOME_UPSTREAM_FAILURE",
            message: "upstream",
            correlation_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            http_status: 502,
          })
        }),
      })
    )
    const networkProvider = new RazorpayContractProvider(
      makeProvider({
        initiatePayment: jest.fn(async () => {
          throw new Error("network down")
        }),
      })
    )

    const upstreamResult = await upstreamProvider.initiatePayment(
      baseInitiateInput as any
    )
    const networkResult = await networkProvider.initiatePayment(
      baseInitiateInput as any
    )

    expect(upstreamResult.ok).toBe(false)
    expect(networkResult.ok).toBe(false)
    if (!upstreamResult.ok) {
      expect(upstreamResult.error.code).toBe(PaymentErrorCode.UPSTREAM_ERROR)
    }
    if (!networkResult.ok) {
      expect(networkResult.error.code).toBe(PaymentErrorCode.UPSTREAM_ERROR)
    }
  })

  it("maps tampered signature errors to SIGNATURE_INVALID", async () => {
    const provider = new RazorpayContractProvider(
      makeProvider({
        authorizePayment: jest.fn(async () => {
          throw new PaymentProviderError({
            code: "RAZORPAY_SIGNATURE_INVALID",
            message: "signature mismatch",
            correlation_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            http_status: 401,
          })
        }),
      })
    )

    const result = await provider.authorizePayment({
      payment_session_id: "ps_contract_map_1",
      cart_id: "cart_contract_map_1",
      provider_payload: {
        razorpay_order_id: "order_1",
        razorpay_payment_id: "pay_1",
        razorpay_signature: "bad_signature",
      },
      correlation_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    } as any)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(PaymentErrorCode.SIGNATURE_INVALID)
    }
  })
})

