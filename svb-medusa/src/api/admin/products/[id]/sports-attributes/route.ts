import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { SportsAttributes } from "../../../../../types/sports-attributes"
import { validateSportsAttributes } from "./validate"

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

    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    // Check product exists
    const product = await pgConnection("product")
      .where("id", id)
      .whereNull("deleted_at")
      .select("id")
      .first()

    if (!product) {
      res.status(404).json({ error: "Product not found" })
      return
    }

    // Write sports_attributes
    await pgConnection("product")
      .where("id", id)
      .update({
        sports_attributes: JSON.stringify(body),
        updated_at: new Date(),
      })

    res.status(200).json({
      success: true,
      sports_attributes: body as SportsAttributes,
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    })
  }
}
