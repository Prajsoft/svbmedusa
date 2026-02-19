import type { MedusaContainer } from "@medusajs/framework/types"
import { runReturnsQcStuckDetector } from "../modules/ops-alert-detectors"

export default async function returnsQcStuckDetectorJob(
  container: MedusaContainer
) {
  await runReturnsQcStuckDetector(container as any)
}

export const config = {
  name: "returns-qc-stuck-detector",
  schedule: process.env.OPS_RETURNS_QC_STUCK_DETECTOR_CRON || "0 */6 * * *",
}
