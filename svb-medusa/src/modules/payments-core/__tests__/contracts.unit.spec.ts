import {
  PaymentErrorCode,
  PaymentProviderError,
  toPaymentErrorEnvelope,
} from "../contracts"

describe("payments-core contracts", () => {
  it("serializes PaymentProviderError to standard error envelope", () => {
    const error = new PaymentProviderError({
      code: "SAMPLE_CODE",
      message: "Sample failure",
      correlation_id: "corr_contract_1",
      http_status: 422,
      details: {
        field: "value",
      },
    })

    expect(error.toErrorEnvelope()).toEqual({
      error: {
        code: "SAMPLE_CODE",
        message: "Sample failure",
        details: {
          field: "value",
        },
        correlation_id: "corr_contract_1",
      },
    })
  })

  it("maps unknown errors to fallback standard envelope", () => {
    const mapped = toPaymentErrorEnvelope(new Error("boom"), {
      correlation_id: "corr_contract_2",
      fallback_code: PaymentErrorCode.INTERNAL_ERROR,
      fallback_message: "Fallback message",
      fallback_http_status: 500,
    })

    expect(mapped).toEqual({
      status: 500,
      body: {
        error: {
          code: PaymentErrorCode.INTERNAL_ERROR,
          message: "boom",
          details: {},
          correlation_id: "corr_contract_2",
        },
      },
    })
  })

  it("preserves explicit error code/message/details when present", () => {
    const mapped = toPaymentErrorEnvelope(
      {
        code: "EXPLICIT_CODE",
        message: "Explicit message",
        details: {
          a: 1,
        },
      },
      {
        correlation_id: "corr_contract_3",
      }
    )

    expect(mapped).toEqual({
      status: 500,
      body: {
        error: {
          code: "EXPLICIT_CODE",
          message: "Explicit message",
          details: {
            a: 1,
          },
          correlation_id: "corr_contract_3",
        },
      },
    })
  })
})
