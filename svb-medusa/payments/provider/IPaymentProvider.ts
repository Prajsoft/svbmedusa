import { z } from "zod"
import {
  PaymentErrorCode,
  PaymentStatus,
  type PaymentErrorCode as PaymentErrorCodeType,
  type PaymentPresentationData,
  type PaymentStatus as PaymentStatusType,
} from "../types"

const nonEmptyString = z.string().trim().min(1)
const correlationIdSchema = z.string().uuid()
const paymentStatusSchema = z.nativeEnum(PaymentStatus)
const paymentErrorCodeSchema = z.nativeEnum(PaymentErrorCode)
const paymentPresentationPrefillSchema = z
  .object({
    name: nonEmptyString.optional(),
    email: z.string().trim().email().optional(),
    phone: nonEmptyString.optional(),
  })
  .strict()
const razorpayPresentationDataSchema = z
  .object({
    type: z.literal("razorpay"),
    keyId: nonEmptyString,
    orderId: nonEmptyString,
    amount: z.number().int().positive(),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
    prefill: paymentPresentationPrefillSchema.optional(),
  })
  .strict()
const stripePresentationDataSchema = z
  .object({
    type: z.literal("stripe"),
    clientSecret: nonEmptyString,
  })
  .strict()
const paymentPresentationDataSchema = z.union([
  razorpayPresentationDataSchema,
  stripePresentationDataSchema,
])

export const paymentCustomerSchema = z
  .object({
    name: nonEmptyString.optional(),
    email: z.string().trim().email().optional(),
    phone: nonEmptyString.optional(),
  })
  .strict()

export type PaymentCustomer = z.infer<typeof paymentCustomerSchema>

const internalReferenceRefinement = (
  value: { order_id?: string; cart_id?: string },
  ctx: z.RefinementCtx
): void => {
  if (value.order_id || value.cart_id) {
    return
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["order_id"],
    message: "Either order_id or cart_id is required.",
  })
}

export const providerRefsSchema = z
  .object({
    provider_payment_id: nonEmptyString.optional(),
    provider_order_id: nonEmptyString.optional(),
    provider_refund_id: nonEmptyString.optional(),
    provider_event_id: nonEmptyString.optional(),
  })
  .strict()

export type ProviderRefs = z.infer<typeof providerRefsSchema>

export const initiatePaymentInputSchema = z
  .object({
    payment_session_id: nonEmptyString,
    order_id: nonEmptyString.optional(),
    cart_id: nonEmptyString.optional(),
    amount: z.number().int().positive(),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
    customer: paymentCustomerSchema.optional(),
    correlation_id: correlationIdSchema,
  })
  .strict()
  .superRefine(internalReferenceRefinement)

export type InitiatePaymentInput = z.infer<typeof initiatePaymentInputSchema>

export const initiatePaymentOutputSchema = z
  .object({
    status: paymentStatusSchema,
    provider_session_data: z.record(z.unknown()),
    presentation_data: paymentPresentationDataSchema,
    provider_refs: providerRefsSchema,
    correlation_id: correlationIdSchema,
  })
  .strict()

export type InitiatePaymentOutput = z.infer<typeof initiatePaymentOutputSchema>
export type { PaymentPresentationData }

export const authorizePaymentInputSchema = z
  .object({
    payment_session_id: nonEmptyString,
    order_id: nonEmptyString.optional(),
    cart_id: nonEmptyString.optional(),
    provider_payload: z.record(z.unknown()),
    provider_payment_id: nonEmptyString.optional(),
    provider_order_id: nonEmptyString.optional(),
    provider_signature: nonEmptyString.optional(),
    correlation_id: correlationIdSchema,
  })
  .strict()
  .superRefine(internalReferenceRefinement)

export type AuthorizePaymentInput = z.infer<typeof authorizePaymentInputSchema>

const paymentActionInputObjectSchema = z
  .object({
    payment_session_id: nonEmptyString,
    order_id: nonEmptyString.optional(),
    cart_id: nonEmptyString.optional(),
    correlation_id: correlationIdSchema,
    provider_refs: providerRefsSchema.optional(),
  })
  .strict()

export const paymentActionInputSchema = paymentActionInputObjectSchema
  .superRefine(internalReferenceRefinement)

export type PaymentActionInput = z.infer<typeof paymentActionInputSchema>

export const refundPaymentInputSchema = paymentActionInputObjectSchema
  .extend({
    amount: z.number().int().positive(),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  })
  .superRefine(internalReferenceRefinement)

export type RefundPaymentInput = z.infer<typeof refundPaymentInputSchema>

export const paymentOperationOutputSchema = z
  .object({
    status: paymentStatusSchema,
    provider_session_data: z.record(z.unknown()),
    provider_refs: providerRefsSchema,
    correlation_id: correlationIdSchema,
  })
  .strict()

export type PaymentOperationOutput = z.infer<typeof paymentOperationOutputSchema>

export const providerMappedErrorSchema = z
  .object({
    code: paymentErrorCodeSchema,
    message: nonEmptyString,
    details: z.record(z.unknown()),
    correlation_id: correlationIdSchema,
  })
  .strict()

export type ProviderMappedError = {
  code: PaymentErrorCodeType
  message: string
  details: Record<string, unknown>
  correlation_id: string
}

export type ProviderResult<TSuccess> =
  | { ok: true; data: TSuccess }
  | { ok: false; error: ProviderMappedError }

export const providerCapabilitiesSchema = z
  .object({
    supportsRefunds: z.boolean(),
    supportsWebhooks: z.boolean(),
    supportsManualCapture: z.boolean(),
  })
  .strict()

export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>

export interface IPaymentProvider {
  initiatePayment(
    input: InitiatePaymentInput
  ): Promise<ProviderResult<InitiatePaymentOutput>>

  authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<ProviderResult<PaymentOperationOutput>>

  capturePayment(
    input: PaymentActionInput
  ): Promise<ProviderResult<PaymentOperationOutput>>

  refundPayment(
    input: RefundPaymentInput
  ): Promise<ProviderResult<PaymentOperationOutput>>

  cancelPayment(
    input: PaymentActionInput
  ): Promise<ProviderResult<PaymentOperationOutput>>

  getCapabilities(): ProviderCapabilities
}

export type ProviderOperationStatus = PaymentStatusType

export function parseInitiatePaymentInput(value: unknown): InitiatePaymentInput {
  return initiatePaymentInputSchema.parse(value)
}

export function parseInitiatePaymentOutput(value: unknown): InitiatePaymentOutput {
  return initiatePaymentOutputSchema.parse(value)
}

export function parseAuthorizePaymentInput(value: unknown): AuthorizePaymentInput {
  return authorizePaymentInputSchema.parse(value)
}

export function parseProviderMappedError(value: unknown): ProviderMappedError {
  return providerMappedErrorSchema.parse(value)
}

export function parseProviderCapabilities(value: unknown): ProviderCapabilities {
  return providerCapabilitiesSchema.parse(value)
}

export function notSupportedResult(input: {
  message: string
  correlation_id: string
  details?: Record<string, unknown>
}): ProviderResult<never> {
  return {
    ok: false,
    error: {
      code: PaymentErrorCode.NOT_SUPPORTED,
      message: input.message,
      details: input.details ?? {},
      correlation_id: input.correlation_id,
    },
  }
}
