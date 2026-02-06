import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendOrderConfirmationWorkflow } from "../workflows/send-order-confirmation"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")

  logger.info(`order.placed event received — Order ID: ${data.id}`)

  try {
    await sendOrderConfirmationWorkflow(container).run({
      input: { id: data.id },
    })

    logger.info(`Order confirmation email sent for Order ID: ${data.id}`)
  } catch (error) {
    logger.error(
      `Failed to send order confirmation for Order ID: ${data.id}`,
      error as Error
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
