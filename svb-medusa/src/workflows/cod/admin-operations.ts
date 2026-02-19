import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { COD_PAYMENT_PROVIDER_ID } from "../checkout/cod-checkout"
import { emitBusinessEvent } from "../../modules/logging/business-events"
import { setCorrelationContext } from "../../modules/logging/correlation"
import { logStructured } from "../../modules/logging/structured-logger"

type ScopeLike = {
  resolve: (key: string) => any
}

type PaymentLike = {
  id?: string
  provider_id?: string
  amount?: number | string | null
  currency_code?: string | null
  captured_at?: string | null
  data?: Record<string, unknown> | null
  refunds?: Array<{
    amount?: number | string | null
    note?: string | null
  }> | null
}

type OrderLike = {
  id: string
  payment_collections?: Array<{
    id?: string
    payments?: PaymentLike[]
  }> | null
}

type CaptureCodPaymentInput = {
  order_id: string
  actor_id?: string
  correlation_id?: string
}

type RecordCodRefundInput = {
  order_id: string
  amount: number
  reason: string
  actor_id?: string
  correlation_id?: string
}

type CaptureCodPaymentResult = {
  order_id: string
  payment_id: string
  already_captured: boolean
}

type RecordCodRefundResult = {
  order_id: string
  payment_id: string
  already_recorded: boolean
}

export class CodAdminOperationError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "CodAdminOperationError"
    this.code = code
  }
}

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(String(value))
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function normalizeReason(reason: string): string {
  return reason.trim()
}

function normalizeAmount(amount: number): number {
  return Math.round(amount * 100) / 100
}

function isSameMoney(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.00001
}

function hasCapturedState(payment: PaymentLike): boolean {
  const codState = payment.data?.cod_state
  if (payment.captured_at) {
    return true
  }

  return codState === "captured" || codState === "refunded"
}

async function getOrder(scope: ScopeLike, orderId: string): Promise<OrderLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "payment_collections.id",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.data",
      "payment_collections.payments.refunds.amount",
      "payment_collections.payments.refunds.note",
    ],
    filters: { id: orderId },
  })

  const order = first<OrderLike>(data)
  if (!order) {
    throw new CodAdminOperationError(
      "ORDER_NOT_FOUND",
      `Order ${orderId} was not found.`
    )
  }

  return order
}

function getCodPayment(order: OrderLike): PaymentLike {
  const paymentCollections = Array.isArray(order.payment_collections)
    ? order.payment_collections
    : []

  for (const paymentCollection of paymentCollections) {
    for (const payment of paymentCollection.payments ?? []) {
      if (payment.provider_id === COD_PAYMENT_PROVIDER_ID && payment.id) {
        return payment
      }
    }
  }

  throw new CodAdminOperationError(
    "COD_PAYMENT_NOT_FOUND",
    `No COD payment was found for order ${order.id}.`
  )
}

function assertValidRefundInput(input: RecordCodRefundInput): void {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new CodAdminOperationError(
      "INVALID_REFUND_AMOUNT",
      "Refund amount must be a positive number."
    )
  }

  if (!normalizeReason(input.reason)) {
    throw new CodAdminOperationError(
      "INVALID_REFUND_REASON",
      "Refund reason is required."
    )
  }
}

export async function captureCodPaymentWorkflow(
  scope: ScopeLike,
  input: CaptureCodPaymentInput
): Promise<CaptureCodPaymentResult> {
  if (!input.order_id?.trim()) {
    throw new CodAdminOperationError(
      "ORDER_ID_REQUIRED",
      "order_id is required."
    )
  }

  setCorrelationContext({
    correlation_id: input.correlation_id,
    workflow_name: "cod_capture_admin_operation",
    order_id: input.order_id,
  })
  logStructured(scope as any, "info", "Capturing COD payment", {
    workflow_name: "cod_capture_admin_operation",
    step_name: "start",
    order_id: input.order_id,
  })

  const order = await getOrder(scope, input.order_id)
  const payment = getCodPayment(order)
  const paymentId = payment.id as string

  if (hasCapturedState(payment)) {
    return {
      order_id: order.id,
      payment_id: paymentId,
      already_captured: true,
    }
  }

  const paymentModule = scope.resolve(Modules.PAYMENT)
  await paymentModule.capturePayment({
    payment_id: paymentId,
    captured_by: input.actor_id,
    is_captured: true,
  })

  await emitBusinessEvent(scope as any, {
    name: "cod.captured",
    correlation_id: input.correlation_id,
    workflow_name: "cod_capture_admin_operation",
    step_name: "emit_event",
    order_id: order.id,
    data: {
      order_id: order.id,
      payment_id: paymentId,
      amount: toNumber(payment.amount),
      currency_code: payment.currency_code,
      actor_id: input.actor_id,
    },
  })

  return {
    order_id: order.id,
    payment_id: paymentId,
    already_captured: false,
  }
}

export async function recordCodRefundWorkflow(
  scope: ScopeLike,
  input: RecordCodRefundInput
): Promise<RecordCodRefundResult> {
  if (!input.order_id?.trim()) {
    throw new CodAdminOperationError(
      "ORDER_ID_REQUIRED",
      "order_id is required."
    )
  }

  assertValidRefundInput(input)
  setCorrelationContext({
    correlation_id: input.correlation_id,
    workflow_name: "cod_refund_record_admin_operation",
    order_id: input.order_id,
  })
  logStructured(scope as any, "info", "Recording COD refund", {
    workflow_name: "cod_refund_record_admin_operation",
    step_name: "start",
    order_id: input.order_id,
  })

  const order = await getOrder(scope, input.order_id)
  const payment = getCodPayment(order)
  const paymentId = payment.id as string
  const reason = normalizeReason(input.reason)
  const amount = normalizeAmount(input.amount)
  const capturedAmount = normalizeAmount(toNumber(payment.amount))

  if (!hasCapturedState(payment)) {
    throw new CodAdminOperationError(
      "COD_PAYMENT_NOT_CAPTURED",
      `COD payment for order ${order.id} must be captured before refund recording.`
    )
  }

  if (amount > capturedAmount) {
    throw new CodAdminOperationError(
      "INVALID_REFUND_AMOUNT",
      "Refund amount cannot exceed the captured COD amount."
    )
  }

  const existingRefunds = Array.isArray(payment.refunds) ? payment.refunds : []
  const alreadyRecorded = existingRefunds.some((refund) => {
    const existingAmount = normalizeAmount(toNumber(refund.amount))
    const existingReason = normalizeReason(refund.note ?? "")
    return isSameMoney(existingAmount, amount) && existingReason === reason
  })

  if (alreadyRecorded) {
    return {
      order_id: order.id,
      payment_id: paymentId,
      already_recorded: true,
    }
  }

  const paymentModule = scope.resolve(Modules.PAYMENT)
  await paymentModule.refundPayment({
    payment_id: paymentId,
    amount,
    note: reason,
    created_by: input.actor_id,
  })

  await emitBusinessEvent(scope as any, {
    name: "cod.refund_recorded",
    correlation_id: input.correlation_id,
    workflow_name: "cod_refund_record_admin_operation",
    step_name: "emit_event",
    order_id: order.id,
    data: {
      order_id: order.id,
      payment_id: paymentId,
      amount,
      reason,
      actor_id: input.actor_id,
    },
  })

  return {
    order_id: order.id,
    payment_id: paymentId,
    already_recorded: false,
  }
}
