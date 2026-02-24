import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { validateSportsAttributes } from "./validate"
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

    res.status(200).json({
      sports_attributes: row.sports_attributes ?? null,
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    })
  }
}

// ── POST /admin/products/:id/sports-attributes ────────────────────────────────

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params
    const body = req.body

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
    const err = error instanceof Error ? error : new Error(String(error))
    // The workflow step throws when the product is not found
    if (err.message.includes("not found")) {
      res.status(404).json({ error: "Product not found" })
      return
    }
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    })
  }
}
