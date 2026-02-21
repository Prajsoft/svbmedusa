import { PaymentSessionStatus } from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  IPaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  PaymentActionInput,
  PaymentOperationOutput,
  ProviderCapabilities,
  ProviderMappedError,
  ProviderResult,
  RefundPaymentInput,
} from "../../../payments/provider"
import { PaymentErrorCode, PaymentStatus } from "../../../payments/types"
import { PaymentProviderError } from "../payments-core/contracts"
import RazorpayPaymentProviderService from "./service"

type ProviderData = Record<string, unknown>

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {}
  }

  return value as Record<string, unknown>
}

function mapToPaymentStatus(status: unknown, data: ProviderData): PaymentStatus {
  const normalized = readText(status).toLowerCase()
  if (normalized === PaymentSessionStatus.AUTHORIZED) {
    return PaymentStatus.AUTHORIZED
  }
  if (normalized === PaymentSessionStatus.CAPTURED) {
    return PaymentStatus.CAPTURED
  }
  if (normalized === PaymentSessionStatus.ERROR) {
    return PaymentStatus.FAILED
  }
  if (normalized === PaymentSessionStatus.CANCELED) {
    return PaymentStatus.CANCELLED
  }
  if (normalized === PaymentSessionStatus.PENDING) {
    return PaymentStatus.PENDING
  }

  const fromData = readText(
    data.payment_status || data.razorpay_payment_status
  ).toUpperCase()
  if (fromData in PaymentStatus) {
    return PaymentStatus[fromData as keyof typeof PaymentStatus]
  }

  return PaymentStatus.PENDING
}

function toProviderRefs(data: ProviderData) {
  return {
    provider_order_id: readText(data.razorpay_order_id) || undefined,
    provider_payment_id: readText(data.razorpay_payment_id) || undefined,
    provider_refund_id: readText(data.razorpay_refund_id) || undefined,
    provider_event_id: readText(data.razorpay_event_id) || undefined,
  }
}

function mapErrorCode(input: {
  code: string
  http_status?: number
}): PaymentErrorCode {
  const code = readText(input.code)
  const httpStatus =
    typeof input.http_status === "number" ? Math.trunc(input.http_status) : 0

  if (code === PaymentErrorCode.SIGNATURE_INVALID) {
    return PaymentErrorCode.SIGNATURE_INVALID
  }
  if (
    code === PaymentErrorCode.AUTH_FAILED ||
    code === PaymentErrorCode.RAZORPAY_AUTH_FAILED
  ) {
    return PaymentErrorCode.AUTH_FAILED
  }
  if (
    code === PaymentErrorCode.RATE_LIMITED ||
    code === PaymentErrorCode.RAZORPAY_RATE_LIMIT
  ) {
    return PaymentErrorCode.RATE_LIMITED
  }
  if (
    code === PaymentErrorCode.UPSTREAM_ERROR ||
    code === PaymentErrorCode.RAZORPAY_UPSTREAM_ERROR ||
    code === "RAZORPAY_API_REQUEST_FAILED"
  ) {
    return PaymentErrorCode.UPSTREAM_ERROR
  }
  if (
    code === PaymentErrorCode.RAZORPAY_SIGNATURE_INVALID ||
    code === PaymentErrorCode.RAZORPAY_SIGNATURE_MISSING
  ) {
    return PaymentErrorCode.SIGNATURE_INVALID
  }
  if (code === "REFUND_NOT_IMPLEMENTED") {
    return PaymentErrorCode.NOT_SUPPORTED
  }
  if (
    code === "CANNOT_CANCEL_PAID_PAYMENT" ||
    code === "RAZORPAY_AMOUNT_IMMUTABLE" ||
    code === PaymentErrorCode.STATE_TRANSITION_INVALID
  ) {
    return PaymentErrorCode.STATE_TRANSITION_INVALID
  }
  if (
    code === PaymentErrorCode.RAZORPAY_BAD_REQUEST ||
    code === "RAZORPAY_SESSION_ID_REQUIRED" ||
    code === "RAZORPAY_INVALID_AMOUNT" ||
    code === "RAZORPAY_PAYMENT_ID_REQUIRED" ||
    code === PaymentErrorCode.VALIDATION_ERROR ||
    code === PaymentErrorCode.CURRENCY_NOT_SUPPORTED
  ) {
    return PaymentErrorCode.VALIDATION_ERROR
  }
  if (
    code === PaymentErrorCode.NOT_SUPPORTED
  ) {
    return PaymentErrorCode.NOT_SUPPORTED
  }
  if (code === PaymentErrorCode.PROVIDER_UNAVAILABLE) {
    return PaymentErrorCode.PROVIDER_UNAVAILABLE
  }
  if (code === PaymentErrorCode.DUPLICATE) {
    return PaymentErrorCode.DUPLICATE
  }
  if (code === PaymentErrorCode.INTERNAL_ERROR) {
    return PaymentErrorCode.INTERNAL_ERROR
  }
  if (
    code === PaymentErrorCode.RAZORPAY_CONFIG_MISSING ||
    code === PaymentErrorCode.RAZORPAY_CONFIG_MODE_MISMATCH ||
    code === PaymentErrorCode.RAZORPAY_PROVIDER_REGISTRATION_FAILED ||
    code === PaymentErrorCode.RAZORPAY_WEBHOOK_SECRET_MISSING ||
    code === "RAZORPAY_DB_CONNECTION_MISSING"
  ) {
    return PaymentErrorCode.PROVIDER_UNAVAILABLE
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return PaymentErrorCode.AUTH_FAILED
  }
  if (httpStatus === 429) {
    return PaymentErrorCode.RATE_LIMITED
  }
  if (httpStatus >= 500) {
    return PaymentErrorCode.UPSTREAM_ERROR
  }
  if (httpStatus >= 400) {
    return PaymentErrorCode.VALIDATION_ERROR
  }

  return PaymentErrorCode.UPSTREAM_ERROR
}

function toMappedError(
  error: unknown,
  fallbackCorrelationId: string
): ProviderMappedError {
  if (error instanceof PaymentProviderError) {
    return {
      code: mapErrorCode({
        code: error.code,
        http_status: error.http_status,
      }),
      message: error.message,
      details: error.details ?? {},
      correlation_id: readText(error.correlation_id) || fallbackCorrelationId,
    }
  }

  return {
    code: PaymentErrorCode.UPSTREAM_ERROR,
    message: error instanceof Error ? error.message : "Unexpected provider error.",
    details: {},
    correlation_id: fallbackCorrelationId,
  }
}

function toMedusaCustomer(input: InitiatePaymentInput) {
  if (!input.customer) {
    return undefined
  }

  const fullName = readText(input.customer.name)
  const [firstName, ...rest] = fullName.split(" ").filter(Boolean)
  const lastName = rest.join(" ").trim()

  return {
    id: `cus_${input.payment_session_id}`,
    email:
      readText(input.customer.email) ||
      `customer+${input.payment_session_id}@example.com`,
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    phone: readText(input.customer.phone) || undefined,
  }
}

export class RazorpayContractProvider implements IPaymentProvider {
  constructor(private readonly provider: RazorpayPaymentProviderService) {}

  private toInitiateOutput(
    output: { status?: unknown; data?: ProviderData },
    correlationId: string
  ): InitiatePaymentOutput {
    const data = readRecord(output.data)
    const presentationData = readRecord(data.presentation_data)

    return {
      status: mapToPaymentStatus(output.status, data),
      provider_session_data: data,
      presentation_data: presentationData as InitiatePaymentOutput["presentation_data"],
      provider_refs: toProviderRefs(data),
      correlation_id: readText(data.correlation_id) || correlationId,
    }
  }

  private toOperationOutput(
    output: { status?: unknown; data?: ProviderData },
    correlationId: string
  ): PaymentOperationOutput {
    const data = readRecord(output.data)

    return {
      status: mapToPaymentStatus(output.status, data),
      provider_session_data: data,
      provider_refs: toProviderRefs(data),
      correlation_id: readText(data.correlation_id) || correlationId,
    }
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<ProviderResult<InitiatePaymentOutput>> {
    try {
      const response = await this.provider.initiatePayment({
        amount: input.amount,
        currency_code: input.currency,
        data: {
          session_id: input.payment_session_id,
          order_id: input.order_id,
          cart_id: input.cart_id,
          correlation_id: input.correlation_id,
        },
        context: {
          customer: toMedusaCustomer(input),
        },
      } as any)

      return {
        ok: true,
        data: this.toInitiateOutput(response as any, input.correlation_id),
      }
    } catch (error) {
      return {
        ok: false,
        error: toMappedError(error, input.correlation_id),
      }
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<ProviderResult<PaymentOperationOutput>> {
    try {
      const payload = readRecord(input.provider_payload)
      const data: ProviderData = {
        ...payload,
        session_id: input.payment_session_id,
        correlation_id: input.correlation_id,
      }

      if (readText(input.order_id)) {
        data.order_id = input.order_id
      }
      if (readText(input.cart_id)) {
        data.cart_id = input.cart_id
      }

      const orderId =
        readText(input.provider_order_id) || readText(payload.razorpay_order_id)
      const paymentId =
        readText(input.provider_payment_id) ||
        readText(payload.razorpay_payment_id)
      const signature =
        readText(input.provider_signature) || readText(payload.razorpay_signature)

      if (orderId) {
        data.razorpay_order_id = orderId
      }
      if (paymentId) {
        data.razorpay_payment_id = paymentId
      }
      if (signature) {
        data.razorpay_signature = signature
      }

      const response = await this.provider.authorizePayment({
        data,
      } as any)

      return {
        ok: true,
        data: this.toOperationOutput(response as any, input.correlation_id),
      }
    } catch (error) {
      return {
        ok: false,
        error: toMappedError(error, input.correlation_id),
      }
    }
  }

  async capturePayment(
    input: PaymentActionInput
  ): Promise<ProviderResult<PaymentOperationOutput>> {
    try {
      const response = await this.provider.capturePayment({
        data: {
          session_id: input.payment_session_id,
          order_id: input.order_id,
          cart_id: input.cart_id,
          correlation_id: input.correlation_id,
          razorpay_order_id: input.provider_refs?.provider_order_id,
          razorpay_payment_id: input.provider_refs?.provider_payment_id,
        },
      } as any)

      return {
        ok: true,
        data: this.toOperationOutput(response as any, input.correlation_id),
      }
    } catch (error) {
      return {
        ok: false,
        error: toMappedError(error, input.correlation_id),
      }
    }
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<ProviderResult<PaymentOperationOutput>> {
    try {
      const response = await this.provider.refundPayment({
        amount: input.amount,
        data: {
          session_id: input.payment_session_id,
          order_id: input.order_id,
          cart_id: input.cart_id,
          correlation_id: input.correlation_id,
          razorpay_order_id: input.provider_refs?.provider_order_id,
          razorpay_payment_id: input.provider_refs?.provider_payment_id,
          amount: input.amount,
          currency_code: input.currency,
        },
      } as any)

      return {
        ok: true,
        data: this.toOperationOutput(response as any, input.correlation_id),
      }
    } catch (error) {
      return {
        ok: false,
        error: toMappedError(error, input.correlation_id),
      }
    }
  }

  async cancelPayment(
    input: PaymentActionInput
  ): Promise<ProviderResult<PaymentOperationOutput>> {
    try {
      const response = await this.provider.cancelPayment({
        data: {
          session_id: input.payment_session_id,
          order_id: input.order_id,
          cart_id: input.cart_id,
          correlation_id: input.correlation_id,
          razorpay_order_id: input.provider_refs?.provider_order_id,
          razorpay_payment_id: input.provider_refs?.provider_payment_id,
        },
      } as any)

      return {
        ok: true,
        data: this.toOperationOutput(response as any, input.correlation_id),
      }
    } catch (error) {
      return {
        ok: false,
        error: toMappedError(error, input.correlation_id),
      }
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsRefunds: true,
      supportsWebhooks: true,
      supportsManualCapture: true,
    }
  }
}

export function createRazorpayContractProvider(
  provider: RazorpayPaymentProviderService
): IPaymentProvider {
  return new RazorpayContractProvider(provider)
}
