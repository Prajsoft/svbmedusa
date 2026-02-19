import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { rtoInitiateWorkflow } from "../../../../../../workflows/rto/rto_initiate"
import { rtoQcFailWorkflow } from "../../../../../../workflows/rto/rto_qc_fail"
import { rtoQcPassWorkflow } from "../../../../../../workflows/rto/rto_qc_pass"
import { rtoReceiveWorkflow } from "../../../../../../workflows/rto/rto_receive"
import {
  toApiErrorResponse,
  validationError,
} from "../../../../../../modules/observability/errors"

type Action = "initiate" | "receive" | "qc_pass" | "qc_fail"

function getAction(body: Record<string, unknown>): Action | null {
  const value = typeof body.action === "string" ? body.action.trim().toLowerCase() : ""

  if (value === "initiate" || value === "receive" || value === "qc_pass" || value === "qc_fail") {
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
          "action must be one of: initiate, receive, qc_pass, qc_fail."
        )
      )
      res.status(mapped.status).json(mapped.body)
      return
    }

    const idempotencyKey =
      typeof body.idempotency_key === "string" ? body.idempotency_key : ""
    const reason = typeof body.reason === "string" ? body.reason : undefined
    const note = typeof body.note === "string" ? body.note : undefined
    const rtoId = typeof body.rto_id === "string" ? body.rto_id : undefined
    const items = Array.isArray(body.items) ? (body.items as any[]) : undefined

    if (action === "initiate") {
      const result = await rtoInitiateWorkflow(req.scope as any, {
        order_id: req.params.order_id,
        rto_id: rtoId,
        idempotency_key: idempotencyKey,
        actor_id: actorId,
        note,
        items,
      })
      res.json(result)
      return
    }

    if (action === "receive") {
      const result = await rtoReceiveWorkflow(req.scope as any, {
        order_id: req.params.order_id,
        rto_id: rtoId,
        idempotency_key: idempotencyKey,
        actor_id: actorId,
        reason,
      })
      res.json(result)
      return
    }

    if (action === "qc_pass") {
      const result = await rtoQcPassWorkflow(req.scope as any, {
        order_id: req.params.order_id,
        rto_id: rtoId,
        idempotency_key: idempotencyKey,
        actor_id: actorId,
        reason,
      })
      res.json(result)
      return
    }

    const result = await rtoQcFailWorkflow(req.scope as any, {
      order_id: req.params.order_id,
      rto_id: rtoId,
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
