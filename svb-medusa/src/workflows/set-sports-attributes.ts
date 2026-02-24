import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

type SetSportsAttributesInput = {
  product_id: string
  sports_attributes: unknown
}

type BatchSetSportsAttributesInput = {
  updates: Array<{ product_id: string; sports_attributes: unknown }>
}

// ── Step: single product ──────────────────────────────────────────────────────
// Compensation restores the previous sports_attributes value so a failed
// downstream step (e.g. a future cache-invalidation step) automatically rolls
// back the DB write.

const setSportsAttributesStep = createStep(
  "set-sports-attributes-step",
  async (input: SetSportsAttributesInput, { container }) => {
    const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    // Fetch current value before overwriting (needed for compensation)
    const current = await pgConnection("product")
      .where("id", input.product_id)
      .whereNull("deleted_at")
      .select("id", "sports_attributes")
      .first()

    if (!current) {
      throw new Error(`Product ${input.product_id} not found`)
    }

    await pgConnection("product")
      .where("id", input.product_id)
      .update({
        sports_attributes: JSON.stringify(input.sports_attributes),
        updated_at: new Date(),
      })

    return new StepResponse(
      // Forward to next step / returned as workflow result
      { product_id: input.product_id, sports_attributes: input.sports_attributes },
      // Compensation payload — passed to the rollback function below
      {
        product_id: input.product_id,
        previous_sports_attributes: current.sports_attributes ?? null,
      }
    )
  },
  // Compensation: restore the previous value when a later step fails
  async (compensationData, { container }) => {
    if (!compensationData) return
    const { product_id, previous_sports_attributes } = compensationData
    const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    await pgConnection("product")
      .where("id", product_id)
      .update({
        sports_attributes: previous_sports_attributes
          ? JSON.stringify(previous_sports_attributes)
          : null,
        updated_at: new Date(),
      })
  }
)

// ── Workflow: single product ──────────────────────────────────────────────────

export const setSportsAttributesWorkflow = createWorkflow(
  "set-sports-attributes",
  (input: SetSportsAttributesInput) => {
    const result = setSportsAttributesStep(input)
    return new WorkflowResponse(result)
  }
)

// ── Step: batch ───────────────────────────────────────────────────────────────
// Fetches previous values for all matched products in one query, writes all
// updates in a single transaction, and compensates by restoring all previous
// values atomically if a later step fails.

const batchSetSportsAttributesStep = createStep(
  "batch-set-sports-attributes-step",
  async (input: BatchSetSportsAttributesInput, { container }) => {
    const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    const productIds = input.updates.map((u) => u.product_id)

    // Fetch current values + filter to existing products in one query
    const existingRows: Array<{ id: string; sports_attributes: unknown }> =
      await pgConnection("product")
        .whereIn("id", productIds)
        .whereNull("deleted_at")
        .select("id", "sports_attributes")

    const existingMap = new Map(existingRows.map((r) => [r.id, r.sports_attributes]))
    const notFound = productIds.filter((id) => !existingMap.has(id))
    const toUpdate = input.updates.filter((u) => existingMap.has(u.product_id))

    if (toUpdate.length > 0) {
      const now = new Date()
      await pgConnection.transaction(async (trx) => {
        await Promise.all(
          toUpdate.map((u) =>
            trx("product").where("id", u.product_id).update({
              sports_attributes: JSON.stringify(u.sports_attributes),
              updated_at: now,
            })
          )
        )
      })
    }

    // Compensation payload: previous state of every product we touched
    const previousStates = toUpdate.map((u) => ({
      product_id: u.product_id,
      sports_attributes: existingMap.get(u.product_id) ?? null,
    }))

    return new StepResponse(
      { updated: toUpdate.length, not_found: notFound },
      previousStates
    )
  },
  // Compensation: restore all previous values atomically
  async (previousStates, { container }) => {
    if (!previousStates || previousStates.length === 0) return
    const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const now = new Date()
    await pgConnection.transaction(async (trx) => {
      await Promise.all(
        previousStates.map(
          (s: { product_id: string; sports_attributes: unknown }) =>
            trx("product").where("id", s.product_id).update({
              sports_attributes: s.sports_attributes
                ? JSON.stringify(s.sports_attributes)
                : null,
              updated_at: now,
            })
        )
      )
    })
  }
)

// ── Workflow: batch ───────────────────────────────────────────────────────────

export const batchSetSportsAttributesWorkflow = createWorkflow(
  "batch-set-sports-attributes",
  (input: BatchSetSportsAttributesInput) => {
    const result = batchSetSportsAttributesStep(input)
    return new WorkflowResponse(result)
  }
)
