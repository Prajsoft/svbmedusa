import type { MedusaContainer } from "@medusajs/framework/types"
import { runShippingWebhookReplay } from "../modules/shipping/webhook-replay"

export default async function shippingWebhookReplayJob(
  container: MedusaContainer
) {
  await runShippingWebhookReplay(container as any)
}

export const config = {
  name: "shipping-webhook-replay",
  schedule:
    process.env.SHIPPING_WEBHOOK_REPLAY_CRON || "*/5 * * * *",
}

