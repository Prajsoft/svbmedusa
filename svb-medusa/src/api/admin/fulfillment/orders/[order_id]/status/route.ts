import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  transitionFulfillmentStatusWorkflow,
} from "../../../../../../workflows/fulfillment-status"
import { toApiErrorResponse } from "../../../../../../modules/observability/errors"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const body = (req.body as Record<string, unknown>) ?? {}
    const toStatus = typeof body.to_status === "string" ? body.to_status : ""
    const fulfillmentAttempt = Number(body.fulfillment_attempt)
    const reason = typeof body.reason === "string" ? body.reason : undefined

    const result = await transitionFulfillmentStatusWorkflow(req.scope as any, {
      order_id: req.params.order_id,
      to_status: toStatus as any,
      fulfillment_attempt: fulfillmentAttempt,
      actor_id: (req as any)?.auth_context?.actor_id,
      reason,
      correlation_id: (req as any)?.correlation_id,
    })

    res.json(result)
  } catch (error) {
    const mapped = toApiErrorResponse(error)
    res.status(mapped.status).json(mapped.body)
  }
}
