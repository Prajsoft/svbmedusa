import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  captureCodPaymentWorkflow,
} from "../../../../../../workflows/cod/admin-operations"
import { toApiErrorResponse } from "../../../../../../modules/observability/errors"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const result = await captureCodPaymentWorkflow(req.scope as any, {
      order_id: req.params.order_id,
      actor_id: (req as any)?.auth_context?.actor_id,
      correlation_id: (req as any)?.correlation_id,
    })

    res.json(result)
  } catch (error) {
    const mapped = toApiErrorResponse(error)
    res.status(mapped.status).json(mapped.body)
  }
}
