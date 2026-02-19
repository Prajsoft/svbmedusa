import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  recordCodRefundWorkflow,
} from "../../../../../../workflows/cod/admin-operations"
import { toApiErrorResponse } from "../../../../../../modules/observability/errors"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const body = (req.body as Record<string, unknown>) ?? {}
    const reason = typeof body.reason === "string" ? body.reason : ""
    const amount = Number(body.amount)

    const result = await recordCodRefundWorkflow(req.scope as any, {
      order_id: req.params.order_id,
      amount,
      reason,
      actor_id: (req as any)?.auth_context?.actor_id,
      correlation_id: (req as any)?.correlation_id,
    })

    res.json(result)
  } catch (error) {
    const mapped = toApiErrorResponse(error)
    res.status(mapped.status).json(mapped.body)
  }
}
