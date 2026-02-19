import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCodAttention } from "../../../../../modules/ops/attention"
import { toApiErrorResponse } from "../../../../../modules/observability/errors"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const items = await getCodAttention(req.scope as any)
    res.status(200).json({
      items,
      count: items.length,
    })
  } catch (error) {
    const mapped = toApiErrorResponse(error, {
      code: "OPS_ATTENTION_COD_FAILED",
      message: "Failed to load COD attention queue.",
      httpStatus: 500,
      category: "internal",
    })
    res.status(mapped.status).json(mapped.body)
  }
}
