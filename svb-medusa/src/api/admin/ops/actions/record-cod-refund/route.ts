import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  toApiErrorResponse,
  validationError,
} from "../../../../../modules/observability/errors"
import { recordCodRefundActionWorkflow } from "../../../../../workflows/ops/actions"

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
    const orderId = typeof body.order_id === "string" ? body.order_id : ""
    const amount = Number(body.amount)
    const reason = typeof body.reason === "string" ? body.reason : ""

    const result = await recordCodRefundActionWorkflow(req.scope as any, {
      order_id: orderId,
      amount,
      reason,
      actor_id: actorId,
      correlation_id: (req as any).correlation_id,
    })

    res.status(200).json(result)
  } catch (error) {
    const mapped = toApiErrorResponse(error)
    res.status(mapped.status).json(mapped.body)
  }
}
