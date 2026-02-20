import type { MedusaContainer } from "@medusajs/framework/types"
import { runStuckPaymentReconciliation } from "../modules/payments-core"

export default async function paymentReconciliationJob(container: MedusaContainer) {
  await runStuckPaymentReconciliation(container)
}

export const config = {
  name: "payment-reconciliation",
  schedule: process.env.PAYMENTS_RECONCILIATION_CRON || "*/20 * * * *",
}
