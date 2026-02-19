import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMetricsSnapshot } from "../../../../modules/observability/metrics"
import {
  toApiErrorResponse,
  validationError,
} from "../../../../modules/observability/errors"

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  try {
    if (process.env.NODE_ENV !== "development") {
      const mapped = toApiErrorResponse(
        validationError(
          "METRICS_SNAPSHOT_DISABLED",
          "Metrics snapshot endpoint is only available in development.",
          { httpStatus: 404 }
        )
      )
      res.status(mapped.status).json(mapped.body)
      return
    }

    res.status(200).json({
      metrics: getMetricsSnapshot(),
    })
  } catch (error) {
    const mapped = toApiErrorResponse(error, {
      code: "METRICS_SNAPSHOT_FAILED",
      message: "Failed to read metrics snapshot.",
      httpStatus: 500,
      category: "internal",
    })
    res.status(mapped.status).json(mapped.body)
  }
}
