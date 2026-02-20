import { PaymentErrorCode, PaymentStatus } from "../types"
import {
  authorizePaymentInputSchema,
  initiatePaymentInputSchema,
  initiatePaymentOutputSchema,
  parseProviderCapabilities,
  paymentOperationOutputSchema,
  providerMappedErrorSchema,
  type AuthorizePaymentInput,
  type InitiatePaymentInput,
  type InitiatePaymentOutput,
  type IPaymentProvider,
  type PaymentOperationOutput,
  type ProviderRefs,
  type ProviderResult,
  type RefundPaymentInput,
} from "../provider"

type ProviderContractSuiteConfig = {
  providerName: string
  createProvider: () => IPaymentProvider | Promise<IPaymentProvider>
  buildInitiateInput: () => InitiatePaymentInput
  buildAuthorizeInput: (input: {
    initiate_input: InitiatePaymentInput
    initiate_output: InitiatePaymentOutput
  }) => AuthorizePaymentInput | Promise<AuthorizePaymentInput>
  buildReauthorizeInput?: (input: {
    first_authorize_input: AuthorizePaymentInput
    first_authorize_output: PaymentOperationOutput
  }) => AuthorizePaymentInput | Promise<AuthorizePaymentInput>
  buildMappedErrorCase: (
    provider: IPaymentProvider
  ) => Promise<ProviderResult<unknown>>
  buildRefundInput?: (input: {
    initiate_input: InitiatePaymentInput
    initiate_output: InitiatePaymentOutput
  }) => RefundPaymentInput
  expectedAuthorizeStatus?: PaymentStatus
  requiredProviderRefKeys?: Array<keyof ProviderRefs>
  assertInitiateIdempotency?: (input: {
    first: InitiatePaymentOutput
    second: InitiatePaymentOutput
  }) => void
  assertAuthorizeIdempotency?: (input: {
    first: PaymentOperationOutput
    second: PaymentOperationOutput
  }) => void
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function resolveProviderRefKey(output: InitiatePaymentOutput): string {
  const refs = output.provider_refs ?? {}
  const fromRefs =
    readText(refs.provider_order_id) ||
    readText(refs.provider_payment_id) ||
    readText(refs.provider_event_id) ||
    readText(refs.provider_refund_id)
  if (fromRefs) {
    return fromRefs
  }

  const data = output.provider_session_data ?? {}
  const fromSessionData =
    readText((data as Record<string, unknown>).provider_order_id) ||
    readText((data as Record<string, unknown>).provider_payment_id) ||
    readText((data as Record<string, unknown>).session_id) ||
    readText((data as Record<string, unknown>).razorpay_order_id)
  if (fromSessionData) {
    return fromSessionData
  }

  return JSON.stringify(data)
}

function resolvePaymentRefKey(output: PaymentOperationOutput): string {
  const refs = output.provider_refs ?? {}
  const fromRefs =
    readText(refs.provider_payment_id) ||
    readText(refs.provider_order_id) ||
    readText(refs.provider_refund_id)
  if (fromRefs) {
    return fromRefs
  }

  const data = output.provider_session_data ?? {}
  const fromSessionData =
    readText((data as Record<string, unknown>).provider_payment_id) ||
    readText((data as Record<string, unknown>).razorpay_payment_id)
  if (fromSessionData) {
    return fromSessionData
  }

  return JSON.stringify({
    status: output.status,
    provider_session_data: output.provider_session_data,
  })
}

function assertHasRequiredRefs(
  output: InitiatePaymentOutput,
  requiredKeys: Array<keyof ProviderRefs>
): void {
  if (!requiredKeys.length) {
    const hasAnyRef = Object.values(output.provider_refs ?? {}).some((value) =>
      Boolean(readText(value))
    )
    expect(hasAnyRef).toBe(true)
    return
  }

  for (const key of requiredKeys) {
    expect(readText(output.provider_refs?.[key])).not.toBe("")
  }
}

export function runProviderContractSuite(config: ProviderContractSuiteConfig): void {
  describe(`${config.providerName} provider contract suite`, () => {
    const expectedAuthorizeStatus =
      config.expectedAuthorizeStatus ?? PaymentStatus.AUTHORIZED
    const requiredRefs = config.requiredProviderRefKeys ?? []

    it("initiatePayment returns valid status, presentation_data, and provider refs", async () => {
      const provider = await config.createProvider()
      const initiateInput = initiatePaymentInputSchema.parse(
        config.buildInitiateInput()
      )

      const result = await provider.initiatePayment(initiateInput)
      expect(result.ok).toBe(true)

      if (!result.ok) {
        throw new Error(result.error.message)
      }

      const parsedOutput = initiatePaymentOutputSchema.parse(result.data)
      expect(Object.values(PaymentStatus)).toContain(parsedOutput.status)
      assertHasRequiredRefs(parsedOutput, requiredRefs)
    })

    it("authorizePayment moves to expected status per payment policy", async () => {
      const provider = await config.createProvider()
      const initiateInput = initiatePaymentInputSchema.parse(
        config.buildInitiateInput()
      )
      const initiated = await provider.initiatePayment(initiateInput)
      expect(initiated.ok).toBe(true)
      if (!initiated.ok) {
        throw new Error(initiated.error.message)
      }

      const initiateOutput = initiatePaymentOutputSchema.parse(initiated.data)
      const authorizeInput = authorizePaymentInputSchema.parse(
        await config.buildAuthorizeInput({
          initiate_input: initiateInput,
          initiate_output: initiateOutput,
        })
      )
      const authorized = await provider.authorizePayment(authorizeInput)
      expect(authorized.ok).toBe(true)
      if (!authorized.ok) {
        throw new Error(authorized.error.message)
      }

      const authorizeOutput = paymentOperationOutputSchema.parse(authorized.data)
      expect(authorizeOutput.status).toBe(expectedAuthorizeStatus)
      expect(Object.values(PaymentStatus)).toContain(authorizeOutput.status)
    })

    it("maps provider failures to canonical PaymentErrorCode only", async () => {
      const provider = await config.createProvider()
      const failedResult = await config.buildMappedErrorCase(provider)

      expect(failedResult.ok).toBe(false)
      if (failedResult.ok) {
        throw new Error("Expected provider failure result for mapping assertion.")
      }

      const parsedError = providerMappedErrorSchema.parse(failedResult.error)
      expect(Object.values(PaymentErrorCode)).toContain(parsedError.code)
    })

    it("returns a valid capabilities shape", async () => {
      const provider = await config.createProvider()
      const capabilities = parseProviderCapabilities(provider.getCapabilities())

      expect(typeof capabilities.supportsRefunds).toBe("boolean")
      expect(typeof capabilities.supportsWebhooks).toBe("boolean")
      expect(typeof capabilities.supportsManualCapture).toBe("boolean")
    })

    it("returns NOT_SUPPORTED for refunds when provider marks refunds unsupported", async () => {
      const provider = await config.createProvider()
      const capabilities = parseProviderCapabilities(provider.getCapabilities())
      if (capabilities.supportsRefunds) {
        return
      }

      const initiateInput = initiatePaymentInputSchema.parse(
        config.buildInitiateInput()
      )
      const initiated = await provider.initiatePayment(initiateInput)
      expect(initiated.ok).toBe(true)
      if (!initiated.ok) {
        throw new Error(initiated.error.message)
      }

      const initiateOutput = initiatePaymentOutputSchema.parse(initiated.data)
      const refundInput =
        config.buildRefundInput?.({
          initiate_input: initiateInput,
          initiate_output: initiateOutput,
        }) ?? {
          payment_session_id: initiateInput.payment_session_id,
          order_id: initiateInput.order_id,
          cart_id: initiateInput.cart_id,
          amount: initiateInput.amount,
          currency: initiateInput.currency,
          provider_refs: {
            provider_order_id: initiateOutput.provider_refs.provider_order_id,
            provider_payment_id:
              initiateOutput.provider_refs.provider_payment_id,
          },
          correlation_id: initiateInput.correlation_id,
        }

      const refunded = await provider.refundPayment(refundInput)
      expect(refunded.ok).toBe(false)
      if (!refunded.ok) {
        expect(refunded.error.code).toBe(PaymentErrorCode.NOT_SUPPORTED)
      }
    })

    it("is idempotent for initiatePayment", async () => {
      const provider = await config.createProvider()
      const initiateInput = initiatePaymentInputSchema.parse(
        config.buildInitiateInput()
      )

      const first = await provider.initiatePayment(initiateInput)
      const second = await provider.initiatePayment(initiateInput)
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      if (!first.ok || !second.ok) {
        throw new Error("Expected initiate calls to succeed for idempotency test.")
      }

      const firstOutput = initiatePaymentOutputSchema.parse(first.data)
      const secondOutput = initiatePaymentOutputSchema.parse(second.data)

      if (config.assertInitiateIdempotency) {
        config.assertInitiateIdempotency({
          first: firstOutput,
          second: secondOutput,
        })
        return
      }

      expect(resolveProviderRefKey(firstOutput)).toBe(
        resolveProviderRefKey(secondOutput)
      )
    })

    it("is idempotent for authorizePayment", async () => {
      const provider = await config.createProvider()
      const initiateInput = initiatePaymentInputSchema.parse(
        config.buildInitiateInput()
      )
      const initiated = await provider.initiatePayment(initiateInput)
      expect(initiated.ok).toBe(true)
      if (!initiated.ok) {
        throw new Error(initiated.error.message)
      }

      const initiateOutput = initiatePaymentOutputSchema.parse(initiated.data)
      const firstAuthorizeInput = authorizePaymentInputSchema.parse(
        await config.buildAuthorizeInput({
          initiate_input: initiateInput,
          initiate_output: initiateOutput,
        })
      )
      const firstAuthorized = await provider.authorizePayment(firstAuthorizeInput)
      expect(firstAuthorized.ok).toBe(true)
      if (!firstAuthorized.ok) {
        throw new Error(firstAuthorized.error.message)
      }

      const firstAuthorizeOutput = paymentOperationOutputSchema.parse(
        firstAuthorized.data
      )
      const secondAuthorizeInput = authorizePaymentInputSchema.parse(
        config.buildReauthorizeInput
          ? await config.buildReauthorizeInput({
              first_authorize_input: firstAuthorizeInput,
              first_authorize_output: firstAuthorizeOutput,
            })
          : firstAuthorizeInput
      )
      const secondAuthorized = await provider.authorizePayment(
        secondAuthorizeInput
      )
      expect(secondAuthorized.ok).toBe(true)
      if (!secondAuthorized.ok) {
        throw new Error(secondAuthorized.error.message)
      }

      const secondAuthorizeOutput = paymentOperationOutputSchema.parse(
        secondAuthorized.data
      )

      if (config.assertAuthorizeIdempotency) {
        config.assertAuthorizeIdempotency({
          first: firstAuthorizeOutput,
          second: secondAuthorizeOutput,
        })
        return
      }

      expect(firstAuthorizeOutput.status).toBe(secondAuthorizeOutput.status)
      expect(resolvePaymentRefKey(firstAuthorizeOutput)).toBe(
        resolvePaymentRefKey(secondAuthorizeOutput)
      )
    })
  })
}
