import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { returnApproveWorkflow } from "../../../../../../../workflows/returns/return_approve"
import { returnQcFailWorkflow } from "../../../../../../../workflows/returns/return_qc_fail"
import { returnQcPassWorkflow } from "../../../../../../../workflows/returns/return_qc_pass"
import { returnReceiveWorkflow } from "../../../../../../../workflows/returns/return_receive"
import {
  toApiErrorResponse,
  validationError,
} from "../../../../../../../modules/observability/errors"

type Action = "approve" | "receive" | "qc_pass" | "qc_fail"

function getAction(body: Record<string, unknown>): Action | null {
  const value = typeof body.action === "string" ? body.action.trim().toLowerCase() : ""

  if (value === "approve" || value === "receive" || value === "qc_pass" || value === "qc_fail") {
    return value
  }

  return null
}

function getActorId(req: MedusaRequest): string | null {
  const actorId = ((req as any)?.auth_context?.actor_id ?? "").toString().trim()
  return actorId || null
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const actorId = getActorId(req)
  if (!actorId) {
    const mapped = toApiErrorResponse(
      validationError("UNAUTHORIZED", "Admin authentication is required.", {
        httpStatus: 401,
      })
    )
    res.status(mapped.status).json(mapped.body)
    return
  }

  try {
    const body = (req.body as Record<string, unknown>) ?? {}
    const action = getAction(body)
    if (!action) {
      const mapped = toApiErrorResponse(
        validationError(
          "INVALID_ACTION",
          "action must be one of: approve, receive, qc_pass, qc_fail."
        )
      )
      res.status(mapped.status).json(mapped.body)
      return
    }

    const idempotencyKey =
      typeof body.idempotency_key === "string" ? body.idempotency_key : ""
    const reason = typeof body.reason === "string" ? body.reason : undefined

    if (action === "approve") {
      const result = await returnApproveWorkflow(req.scope as any, {
        order_id: req.params.order_id,
        return_id: req.params.return_id,
        idempotency_key: idempotencyKey,
        actor_id: actorId,
        reason,
      })
      res.json(result)
      return
    }

    if (action === "receive") {
      const result = await returnReceiveWorkflow(req.scope as any, {
        order_id: req.params.order_id,
        return_id: req.params.return_id,
        idempotency_key: idempotencyKey,
        actor_id: actorId,
        reason,
      })
      res.json(result)
      return
    }

    if (action === "qc_pass") {
      const refundAmountRaw = Number(body.refund_amount)
      const refundAmount = Number.isFinite(refundAmountRaw) ? refundAmountRaw : undefined
      const refundReason =
        typeof body.refund_reason === "string" ? body.refund_reason : undefined

      const result = await returnQcPassWorkflow(req.scope as any, {
        order_id: req.params.order_id,
        return_id: req.params.return_id,
        idempotency_key: idempotencyKey,
        actor_id: actorId,
        reason,
        refund_amount: refundAmount,
        refund_reason: refundReason,
      })
      res.json(result)
      return
    }

    const result = await returnQcFailWorkflow(req.scope as any, {
      order_id: req.params.order_id,
      return_id: req.params.return_id,
      idempotency_key: idempotencyKey,
      actor_id: actorId,
      reason,
    })
    res.json(result)
  } catch (error) {
    const mapped = toApiErrorResponse(error)
    res.status(mapped.status).json(mapped.body)
  }
}
