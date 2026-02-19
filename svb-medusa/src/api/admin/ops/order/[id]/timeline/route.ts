import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getOrderTimeline } from "../../../../../../modules/ops/attention"
import {
  toApiErrorResponse,
  validationError,
} from "../../../../../../modules/observability/errors"

function resolveLimit(rawLimit: unknown): number | undefined {
  if (typeof rawLimit === "undefined") {
    return undefined
  }

  const parsed = Number(rawLimit)
  if (!Number.isFinite(parsed)) {
    return undefined
  }

  const value = Math.floor(parsed)
  return value > 0 ? value : undefined
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const orderId = req.params.id?.trim()
    if (!orderId) {
      const mapped = toApiErrorResponse(
        validationError("ORDER_ID_REQUIRED", "Order id is required.")
      )
      res.status(mapped.status).json(mapped.body)
      return
    }

    const queryLimit =
      req.query && typeof req.query === "object"
        ? (req.query as Record<string, unknown>).limit
        : undefined
    const limit = resolveLimit(queryLimit)
    const timeline = await getOrderTimeline(req.scope as any, orderId, limit)

    res.status(200).json({
      order_id: orderId,
      timeline,
      count: timeline.length,
    })
  } catch (error) {
    const mapped = toApiErrorResponse(error, {
      code: "OPS_ORDER_TIMELINE_FAILED",
      message: "Failed to load order audit timeline.",
      httpStatus: 500,
      category: "internal",
    })
    res.status(mapped.status).json(mapped.body)
  }
}
