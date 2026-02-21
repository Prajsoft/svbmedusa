import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { COD_PAYMENT_PROVIDER_ID } from "../workflows/checkout/cod-checkout"
import { emitBusinessEvent } from "../modules/logging/business-events"
import { setCorrelationContext } from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"

type PaymentLike = {
  id?: string
  provider_id?: string
  amount?: number | string | null
  currency_code?: string | null
  refunds?: Array<{
    amount?: number | string | null
    note?: string | null
  }> | null
}

type OrderLike = {
  id: string
  metadata?: Record<string, unknown> | null
  payment_collections?: Array<{
    payments?: PaymentLike[]
  }> | null
}

type ReturnPrepaidRefundRequestedEvent = {
  order_id?: string
  return_id?: string
  amount?: number
  reason?: string
  actor_id?: string
  reference?: string
  correlation_id?: string
}

type HandlerDeps = {
  loadOrder: (container: any, orderId: string) => Promise<OrderLike>
  findPrepaidPayment: (order: OrderLike) => PaymentLike | null
  updateReturnRefundState: (
    container: any,
    input: {
      order: OrderLike
      returnId: string
      status: "recorded"
      reference: string
      updatedAt: string
    }
  ) => Promise<void>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function buildRefundNote(input: { reason: string; reference: string }): string {
  if (!input.reason) {
    return `[${input.reference}]`
  }
  return `${input.reason} [${input.reference}]`
}

function hasMatchingRefund(
  payment: PaymentLike,
  input: { amount: number; reference: string }
): boolean {
  const refunds = Array.isArray(payment.refunds) ? payment.refunds : []
  return refunds.some((refund) => {
    const existingAmount = toNumber(refund.amount)
    const note = readText(refund.note)
    return existingAmount === input.amount && note.includes(`[${input.reference}]`)
  })
}

async function loadOrder(container: any, orderId: string): Promise<OrderLike> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "metadata",
      "payment_collections.id",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.refunds.amount",
      "payment_collections.payments.refunds.note",
    ],
    filters: {
      id: orderId,
    },
  })

  const order = Array.isArray(data) ? (data[0] as OrderLike | undefined) : undefined
  if (!order?.id) {
    throw new Error(`Order ${orderId} not found for prepaid refund request.`)
  }

  return order
}

function findPrepaidPayment(order: OrderLike): PaymentLike | null {
  const paymentCollections = Array.isArray(order.payment_collections)
    ? order.payment_collections
    : []

  for (const collection of paymentCollections) {
    const payments = Array.isArray(collection.payments) ? collection.payments : []
    for (const payment of payments) {
      if (!payment.id) {
        continue
      }
      if (payment.provider_id === COD_PAYMENT_PROVIDER_ID) {
        continue
      }
      return payment
    }
  }

  return null
}

async function updateReturnRefundState(
  container: any,
  input: {
    order: OrderLike
    returnId: string
    status: "recorded"
    reference: string
    updatedAt: string
  }
): Promise<void> {
  const metadata = {
    ...((input.order.metadata ?? {}) as Record<string, unknown>),
  }
  const intents = metadata.return_intents_v1
  if (!intents || typeof intents !== "object") {
    return
  }

  const returnIntents = {
    ...(intents as Record<string, any>),
  }
  const targetIntent = returnIntents[input.returnId]
  if (!targetIntent || typeof targetIntent !== "object") {
    return
  }

  returnIntents[input.returnId] = {
    ...targetIntent,
    refund: {
      ...((targetIntent.refund ?? {}) as Record<string, unknown>),
      status: input.status,
      reference: input.reference,
      updated_at: input.updatedAt,
    },
  }

  metadata.return_intents_v1 = returnIntents

  const orderModule = container.resolve(Modules.ORDER)
  await orderModule.updateOrders(input.order.id, {
    metadata,
  })
}

export function createReturnPrepaidRefundRequestedHandler(
  deps: Partial<HandlerDeps> = {}
) {
  const resolvedDeps: HandlerDeps = {
    loadOrder: deps.loadOrder ?? loadOrder,
    findPrepaidPayment: deps.findPrepaidPayment ?? findPrepaidPayment,
    updateReturnRefundState: deps.updateReturnRefundState ?? updateReturnRefundState,
  }

  return async function handleReturnPrepaidRefundRequested({
    event: { data },
    container,
  }: SubscriberArgs<ReturnPrepaidRefundRequestedEvent>) {
    const payload = data ?? {}
    const orderId = readText(payload.order_id)
    const returnId = readText(payload.return_id)
    const reason = readText(payload.reason)
    const actorId = readText(payload.actor_id) || undefined
    const reference =
      readText(payload.reference) || `prepaid-refund:${orderId}:${returnId}`
    const correlationId = readText(payload.correlation_id) || reference
    const amount = Math.round(toNumber(payload.amount))

    setCorrelationContext({
      correlation_id: correlationId,
      workflow_name: "subscriber_prepaid_refund_requested",
      order_id: orderId || undefined,
      return_id: returnId || undefined,
    })

    if (!orderId || !returnId || amount <= 0) {
      logStructured(container as any, "error", "invalid prepaid refund event payload", {
        workflow_name: "subscriber_prepaid_refund_requested",
        step_name: "validate_event",
        order_id: orderId || undefined,
        return_id: returnId || undefined,
        error_code: "INVALID_PREPAID_REFUND_EVENT",
      })
      return
    }

    try {
      const order = await resolvedDeps.loadOrder(container, orderId)
      const payment = resolvedDeps.findPrepaidPayment(order)

      if (!payment?.id) {
        throw new Error(`No prepaid payment found for order ${orderId}.`)
      }

      if (hasMatchingRefund(payment, { amount, reference })) {
        await emitBusinessEvent(container as any, {
          name: "return.prepaid_refund_processed",
          correlation_id: correlationId,
          workflow_name: "subscriber_prepaid_refund_requested",
          step_name: "dedupe",
          order_id: orderId,
          return_id: returnId,
          actor: actorId ? { type: "admin", id: actorId } : "system",
          data: {
            order_id: orderId,
            return_id: returnId,
            payment_id: payment.id,
            amount,
            reference,
            status: "already_refunded",
          },
        })
        return
      }

      const paymentModule = container.resolve(Modules.PAYMENT)
      await paymentModule.refundPayment({
        payment_id: payment.id,
        amount,
        note: buildRefundNote({ reason, reference }),
        created_by: actorId,
      })

      const now = new Date().toISOString()
      await resolvedDeps.updateReturnRefundState(container, {
        order,
        returnId,
        status: "recorded",
        reference,
        updatedAt: now,
      })

      await emitBusinessEvent(container as any, {
        name: "return.prepaid_refund_processed",
        correlation_id: correlationId,
        workflow_name: "subscriber_prepaid_refund_requested",
        step_name: "refund_payment",
        order_id: orderId,
        return_id: returnId,
        actor: actorId ? { type: "admin", id: actorId } : "system",
        data: {
          order_id: orderId,
          return_id: returnId,
          payment_id: payment.id,
          amount,
          reference,
          status: "recorded",
        },
      })
    } catch (error) {
      const code =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? ((error as { code: string }).code as string)
          : "PREPAID_REFUND_FAILED"

      logStructured(container as any, "error", "prepaid refund processing failed", {
        workflow_name: "subscriber_prepaid_refund_requested",
        step_name: "refund_payment",
        order_id: orderId,
        return_id: returnId,
        error_code: code,
        meta: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })

      await emitBusinessEvent(container as any, {
        name: "return.prepaid_refund_failed",
        correlation_id: correlationId,
        workflow_name: "subscriber_prepaid_refund_requested",
        step_name: "refund_payment",
        order_id: orderId,
        return_id: returnId,
        actor: actorId ? { type: "admin", id: actorId } : "system",
        data: {
          order_id: orderId,
          return_id: returnId,
          amount,
          reference,
          error_code: code,
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })
    }
  }
}

export default createReturnPrepaidRefundRequestedHandler()

export const config: SubscriberConfig = {
  event: "return.prepaid_refund_requested",
}
