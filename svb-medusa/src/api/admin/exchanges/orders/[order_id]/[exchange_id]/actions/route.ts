import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { exchangeApproveWorkflow } from "../../../../../../../workflows/exchanges/exchange_approve"
import { exchangeReceiveReturnWorkflow } from "../../../../../../../workflows/exchanges/exchange_receive_return"
import {
  toApiErrorResponse,
  validationError,
} from "../../../../../../../modules/observability/errors"

type Action = "approve" | "receive"

function getAction(body: Record<string, unknown>): Action | null {
  const value = typeof body.action === "string" ? body.action.trim().toLowerCase() : ""
  if (value === "approve" || value === "receive") {
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
          "action must be one of: approve, receive."
        )
      )
      res.status(mapped.status).json(mapped.body)
      return
    }

    const idempotencyKey =
      typeof body.idempotency_key === "string" ? body.idempotency_key : ""
    const reason = typeof body.reason === "string" ? body.reason : undefined

    if (action === "approve") {
      const result = await exchangeApproveWorkflow(req.scope as any, {
        order_id: req.params.order_id,
        exchange_id: req.params.exchange_id,
        idempotency_key: idempotencyKey,
        actor_id: actorId,
        reason,
      })
      res.json(result)
      return
    }

    const result = await exchangeReceiveReturnWorkflow(req.scope as any, {
      order_id: req.params.order_id,
      exchange_id: req.params.exchange_id,
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
