import type { MedusaContainer } from "@medusajs/framework/types"
import { runCodCapturePendingDetector } from "./ops-alert-detectors"

export default async function codCapturePendingDetectorJob(
  container: MedusaContainer
) {
  await runCodCapturePendingDetector(container as any)
}

export const config = {
  name: "cod-capture-pending-detector",
  schedule:
    process.env.OPS_COD_CAPTURE_PENDING_DETECTOR_CRON || "0 */6 * * *",
}
