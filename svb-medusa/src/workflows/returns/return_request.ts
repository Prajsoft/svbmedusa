import {
  assertReturnReasonCode,
  createReturnIntent,
  emitReturnEvent,
  getOrder,
  getReturnIntent,
  normalizeReturnId,
  persistReturnIntent,
  requireIdempotencyKey,
  resolveRefundAmount,
  resolveReturnItems,
  ReturnItemInput,
  ReturnReasonCode,
  ReturnWorkflowError,
  withRefund,
} from "./shared"
import { increment } from "../../modules/observability/metrics"

export type ReturnRequestWorkflowInput = {
  order_id: string
  return_id?: string
  idempotency_key: string
  reason_code: ReturnReasonCode
  note?: string
  actor_id?: string
  items?: ReturnItemInput[]
  refund_amount?: number
  refund_reason?: string
}

export type ReturnRequestWorkflowResult = {
  order_id: string
  return_id: string
  state: "requested"
  changed: boolean
}

export async function returnRequestWorkflow(
  scope: { resolve: (key: string) => any },
  input: ReturnRequestWorkflowInput
): Promise<ReturnRequestWorkflowResult> {
  const orderId = input.order_id?.trim()
  let outcome: "success" | "failure" = "failure"
  let failureCode: string | undefined

  try {
    if (!orderId) {
      throw new ReturnWorkflowError("ORDER_ID_REQUIRED", "order_id is required.")
    }

    const idempotencyKey = requireIdempotencyKey(input.idempotency_key)
    const rawReason = String(input.reason_code ?? "").trim()
    assertReturnReasonCode(rawReason)
    const reasonCode = rawReason as ReturnReasonCode
    const returnId = normalizeReturnId(input.return_id)
    const order = await getOrder(scope, orderId)
    const existingIntent = getReturnIntent(order, returnId)

    if (existingIntent) {
      const replayEntry = existingIntent.idempotency_log?.[idempotencyKey]
      if (replayEntry?.action === "return_request") {
        outcome = "success"
        return {
          order_id: order.id,
          return_id: returnId,
          state: "requested",
          changed: false,
        }
      }

      throw new ReturnWorkflowError(
        "RETURN_ALREADY_EXISTS",
        `Return ${returnId} already exists for order ${order.id}.`
      )
    }

    const returnItems = await resolveReturnItems(scope, order, input.items)
    let intent = createReturnIntent({
      order_id: order.id,
      return_id: returnId,
      reason_code: reasonCode,
      note: input.note,
      items: returnItems,
      idempotency_key: idempotencyKey,
      actor_id: input.actor_id,
    })
    const refundAmount = resolveRefundAmount(order, intent, input.refund_amount)

    if (refundAmount > 0) {
      intent = withRefund(intent, {
        mode: "prepaid",
        status: "pending",
        amount: refundAmount,
        reason: input.refund_reason?.trim() || undefined,
        updated_at: new Date().toISOString(),
      })
    }

    await persistReturnIntent(scope, order, intent)

    await emitReturnEvent(scope, "return.requested", {
      order_id: order.id,
      return_id: returnId,
      reason_code: reasonCode,
      actor_id: input.actor_id,
      item_count: intent.items.length,
    })

    outcome = "success"
    return {
      order_id: order.id,
      return_id: returnId,
      state: "requested",
      changed: true,
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
    ) {
      const code = (error as { code: string }).code.trim()
      failureCode = code || undefined
    }
    throw error
  } finally {
    increment(`workflow.return_request.${outcome}_total`, {
      workflow: "return_request",
      result: outcome,
      ...(failureCode ? { error_code: failureCode } : {}),
    })
  }
}
