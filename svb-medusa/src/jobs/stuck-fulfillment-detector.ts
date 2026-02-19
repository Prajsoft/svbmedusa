import type { MedusaContainer } from "@medusajs/framework/types"
import { runStuckFulfillmentDetector } from "./ops-alert-detectors"

export default async function stuckFulfillmentDetectorJob(
  container: MedusaContainer
) {
  await runStuckFulfillmentDetector(container as any)
}

export const config = {
  name: "stuck-fulfillment-detector",
  schedule: process.env.OPS_STUCK_FULFILLMENT_DETECTOR_CRON || "*/15 * * * *",
}
