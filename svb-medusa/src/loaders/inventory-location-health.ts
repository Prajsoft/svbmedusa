import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// ── Inventory location DB health check ────────────────────────────────────────
// Runs after Medusa boots and the database is ready.
// Verifies that the configured stock location IDs actually exist in the DB.
//
// If an ID is set in env vars but the corresponding row is missing (e.g. was
// deleted from the admin panel, or the wrong ID was copy-pasted), inventory
// adjustments would be made to a phantom location.  Catching this at startup
// is far safer than discovering it during a live return or exchange.
//
// Behaviour:
//   - production: throws → prevents the server from accepting traffic
//   - development: logs a warning → allows local work without all four buckets

export default async function inventoryLocationHealthCheck({
  container,
}: {
  container: any
}) {
  const sellableId = process.env.SVB_SELLABLE_LOCATION_ID?.trim() || ""
  const qcHoldId = process.env.SVB_QC_HOLD_LOCATION_ID?.trim() || ""
  const exchangeHoldId = process.env.SVB_EXCHANGE_HOLD_LOCATION_ID?.trim() || ""
  const damageId = process.env.SVB_DAMAGE_LOCATION_ID?.trim() || ""

  const configured: Array<{ envKey: string; id: string }> = [
    { envKey: "SVB_SELLABLE_LOCATION_ID", id: sellableId },
    { envKey: "SVB_QC_HOLD_LOCATION_ID", id: qcHoldId },
    { envKey: "SVB_EXCHANGE_HOLD_LOCATION_ID", id: exchangeHoldId },
    { envKey: "SVB_DAMAGE_LOCATION_ID", id: damageId },
  ].filter((entry) => Boolean(entry.id))

  // Nothing configured — name-based resolution will run at first workflow
  // invocation.  Nothing to health-check here.
  if (!configured.length) {
    return
  }

  let pgConnection: ReturnType<typeof import("knex").default>

  try {
    pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  } catch {
    // If the PG connection isn't available at loader time (shouldn't happen
    // in normal Medusa boot), skip the check and let the workflow fail later.
    console.warn({
      event: "INVENTORY_LOCATION_HEALTH_CHECK_SKIPPED",
      reason: "PG_CONNECTION not available at loader time.",
    })
    return
  }

  const configuredIds = configured.map((e) => e.id)
  const rows = await pgConnection("stock_location")
    .whereIn("id", configuredIds)
    .whereNull("deleted_at")
    .select("id", "name")

  const foundIds = new Set<string>(rows.map((r: { id: string }) => r.id))

  const missing = configured.filter((entry) => !foundIds.has(entry.id))

  if (!missing.length) {
    console.log({
      event: "INVENTORY_LOCATION_HEALTH_CHECK_PASSED",
      locations: rows.map((r: { id: string; name: string }) => `${r.id} (${r.name})`),
    })
    return
  }

  const detail = missing.map((e) => `${e.envKey}=${e.id}`).join(", ")
  const message =
    `Inventory location health check failed: the following configured IDs do not ` +
    `exist in the stock_location table: ${detail}. ` +
    `Update the env vars to match IDs visible in Medusa Admin → Inventory → Locations.`

  if (process.env.NODE_ENV === "production") {
    throw new Error(message)
  }

  console.warn({ event: "INVENTORY_LOCATION_HEALTH_CHECK_FAILED", reason: message })
}
