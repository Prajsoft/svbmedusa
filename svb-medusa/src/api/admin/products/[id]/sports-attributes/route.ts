import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { toApiErrorResponse } from "../../../../../modules/observability/errors"
import { validateSportsAttributes } from "./validate"
import { normalizeSportsAttributes } from "./normalize"
import { setSportsAttributesWorkflow } from "../../../../../workflows/set-sports-attributes"

// ── GET /admin/products/:id/sports-attributes ─────────────────────────────────

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    const row = await pgConnection("product")
      .where("id", id)
      .whereNull("deleted_at")
      .select("id", "sports_attributes")
      .first()

    if (!row) {
      res.status(404).json({ error: "Product not found" })
      return
    }

    const normalized = normalizeSportsAttributes(row.sports_attributes)

    res.status(200).json({
      sports_attributes: normalized ?? null,
    })
  } catch (error) {
    const mapped = toApiErrorResponse(error)
    res.status(mapped.status).json(mapped.body)
  }
}

// ── POST /admin/products/:id/sports-attributes ────────────────────────────────

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    const body = normalizeSportsAttributes(req.body)

    // Validate request body
    const validation = validateSportsAttributes(body)
    if (!validation.valid) {
      res.status(400).json({
        error: "Validation failed",
        details: validation.errors,
      })
      return
    }

    const { result } = await setSportsAttributesWorkflow(req.scope).run({
      input: { product_id: id, sports_attributes: body },
    })

    res.status(200).json({
      success: true,
      sports_attributes: result.sports_attributes,
    })
  } catch (error) {
    const mapped = toApiErrorResponse(error)
    res.status(mapped.status).json(mapped.body)
  }
}
