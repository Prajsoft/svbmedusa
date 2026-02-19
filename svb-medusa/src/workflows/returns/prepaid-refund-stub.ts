import { emitBusinessEvent } from "../../modules/logging/business-events"

type ScopeLike = {
  resolve: (key: string) => any
}

export type PrepaidRefundStubInput = {
  order_id: string
  return_id: string
  amount: number
  reason?: string
  actor_id?: string
}

export type PrepaidRefundStubResult = {
  requested: true
  reference: string
}

export async function requestPrepaidRefundWorkflowStub(
  scope: ScopeLike,
  input: PrepaidRefundStubInput
): Promise<PrepaidRefundStubResult> {
  const reference = `prepaid-refund:${input.order_id}:${input.return_id}`
  await emitBusinessEvent(scope as any, {
    name: "return.prepaid_refund_requested",
    workflow_name: "return_prepaid_refund_stub",
    step_name: "emit_event",
    order_id: input.order_id,
    return_id: input.return_id,
    data: {
      order_id: input.order_id,
      return_id: input.return_id,
      amount: input.amount,
      reason: input.reason?.trim() || undefined,
      actor_id: input.actor_id,
      reference,
    },
  })

  return {
    requested: true,
    reference,
  }
}
