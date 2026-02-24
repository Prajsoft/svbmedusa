import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { validateSportsAttributes } from "../../[id]/sports-attributes/validate"
import { batchSetSportsAttributesWorkflow } from "../../../../../workflows/set-sports-attributes"

// ── Limits ────────────────────────────────────────────────────────────────────
const MAX_BATCH_SIZE = 200

// ── POST /admin/products/sports-attributes/batch ──────────────────────────────
// Bulk-upsert sports_attributes for multiple products in a single round-trip.
//
// Request body:
//   {
//     updates: Array<{
//       product_id: string
//       sports_attributes: SportsAttributes
//     }>
//   }
//
// Response (200):
//   {
//     updated: number          // rows affected
//     not_found: string[]      // product_ids that don't exist / are deleted
//   }
//
// Response (400): validation errors keyed by index, e.g.
//   {
//     error: "Validation failed",
//     item_errors: {
//       "2": { "sport": "Must be 'Cricket'" }
//     }
//   }

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const body = req.body as Record<string, unknown>

    // ── Top-level shape check ────────────────────────────────────────────────
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Request body must be a JSON object" })
      return
    }

    const { updates } = body as { updates?: unknown }

    if (!Array.isArray(updates)) {
      res.status(400).json({ error: "'updates' must be an array" })
      return
    }

    if (updates.length === 0) {
      res.status(400).json({ error: "'updates' must not be empty" })
      return
    }

    if (updates.length > MAX_BATCH_SIZE) {
      res.status(400).json({
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} items`,
      })
      return
    }

    // ── Per-item validation ──────────────────────────────────────────────────
    const itemErrors: Record<string, Record<string, string>> = {}

    for (let i = 0; i < updates.length; i++) {
      const item = updates[i] as Record<string, unknown>

      if (!item || typeof item !== "object" || Array.isArray(item)) {
        itemErrors[String(i)] = { root: "Each item must be an object" }
        continue
      }

      // product_id
      if (typeof item.product_id !== "string" || !item.product_id.trim()) {
        itemErrors[String(i)] = { product_id: "Must be a non-empty string" }
        // Don't validate sports_attributes if product_id is invalid
        continue
      }

      // sports_attributes
      const attrValidation = validateSportsAttributes(item.sports_attributes)
      if (!attrValidation.valid) {
        itemErrors[String(i)] = attrValidation.errors
      }
    }

    if (Object.keys(itemErrors).length > 0) {
      res.status(400).json({
        error: "Validation failed",
        item_errors: itemErrors,
      })
      return
    }

    // All items are valid — cast to typed array
    const validUpdates = updates as Array<{
      product_id: string
      sports_attributes: unknown
    }>

    // ── Execute workflow (handles existence check, transaction, compensation) ─
    const { result } = await batchSetSportsAttributesWorkflow(req.scope).run({
      input: { updates: validUpdates },
    })

    res.status(200).json({
      updated: result.updated,
      not_found: result.not_found,
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    })
  }
}
