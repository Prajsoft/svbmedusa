import type { MedusaContainer } from "@medusajs/framework/types"
import { logStructured } from "../modules/logging/structured-logger"
import { getShippingPersistenceRepository } from "../modules/shipping/provider-router"

export default async function shippingEventsPayloadPurgeJob(
  container: MedusaContainer
) {
  const repository = getShippingPersistenceRepository(container as any)
  const result = await repository.purgeExpiredSanitizedPayloads()

  logStructured(container as any, "info", "shipping payload purge executed", {
    workflow_name: "shipping_events_payload_purge",
    step_name: "purge",
    meta: {
      ttl_days: result.ttl_days,
      cutoff_at: result.cutoff_at.toISOString(),
      scrubbed_count: result.scrubbed_count,
    },
  })
}

export const config = {
  name: "shipping-events-payload-purge",
  schedule:
    process.env.SHIPPING_EVENTS_PAYLOAD_PURGE_CRON || "0 2 * * *",
}

