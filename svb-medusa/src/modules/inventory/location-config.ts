// ── Inventory location config validation ──────────────────────────────────────
// All four bucket location IDs must be configured together — a partial set is
// ambiguous and likely indicates a copy-paste mistake during deployment.
//
// Validation fires at medusa-config.ts load time (before the DB is ready) so
// the process never starts with a broken inventory mapping.

export class InventoryLocationConfigError extends Error {
  code: string
  reason: string

  constructor(reason: string) {
    super("INVENTORY_LOCATION_CONFIG_INVALID")
    this.name = "InventoryLocationConfigError"
    this.code = "INVENTORY_LOCATION_CONFIG_INVALID"
    this.reason = reason
  }
}

export type InventoryLocationConfig = {
  sellableLocationId: string
  qcHoldLocationId: string
  exchangeHoldLocationId: string
  damageLocationId: string
}

/**
 * Validates inventory bucket location env vars.
 *
 * Rules:
 *  - If any of the four IDs are set, all four must be set (partial = error).
 *  - If none are set in production, logs a prominent warning — name-based
 *    resolution will run at first workflow invocation and fail loudly if the
 *    location names don't match. This is intentionally non-fatal so that dev
 *    environments without all four locations configured can still start.
 *
 * Returns the validated config when all four IDs are present, null otherwise.
 */
export function validateInventoryLocationConfig(
  env: NodeJS.ProcessEnv
): InventoryLocationConfig | null {
  const sellableLocationId = env.SVB_SELLABLE_LOCATION_ID?.trim() || ""
  const qcHoldLocationId = env.SVB_QC_HOLD_LOCATION_ID?.trim() || ""
  const exchangeHoldLocationId = env.SVB_EXCHANGE_HOLD_LOCATION_ID?.trim() || ""
  const damageLocationId = env.SVB_DAMAGE_LOCATION_ID?.trim() || ""

  const configuredCount = [
    sellableLocationId,
    qcHoldLocationId,
    exchangeHoldLocationId,
    damageLocationId,
  ].filter(Boolean).length

  // All four present — valid.
  if (configuredCount === 4) {
    return { sellableLocationId, qcHoldLocationId, exchangeHoldLocationId, damageLocationId }
  }

  // None present — fall through to name-based resolution at runtime.
  if (configuredCount === 0) {
    if (env.NODE_ENV === "production") {
      console.warn({
        event: "INVENTORY_LOCATION_IDS_NOT_CONFIGURED",
        reason:
          "SVB_SELLABLE_LOCATION_ID, SVB_QC_HOLD_LOCATION_ID, SVB_EXCHANGE_HOLD_LOCATION_ID, " +
          "and SVB_DAMAGE_LOCATION_ID are not set. Inventory workflows will fall back to " +
          "name-based stock location lookup on every call. Set all four IDs in production " +
          "to use the faster, more reliable ID-based path.",
      })
    }
    return null
  }

  // Partial configuration — always fatal.
  const missing: string[] = []
  if (!sellableLocationId) missing.push("SVB_SELLABLE_LOCATION_ID")
  if (!qcHoldLocationId) missing.push("SVB_QC_HOLD_LOCATION_ID")
  if (!exchangeHoldLocationId) missing.push("SVB_EXCHANGE_HOLD_LOCATION_ID")
  if (!damageLocationId) missing.push("SVB_DAMAGE_LOCATION_ID")

  throw new InventoryLocationConfigError(
    `Partial inventory location configuration: ${configuredCount} of 4 IDs are set. ` +
    `Set all four or none. Missing: ${missing.join(", ")}.`
  )
}
