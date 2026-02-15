import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendOrderConfirmationWorkflow } from "../workflows/send-order-confirmation"

// Prevent duplicate emails if the event fires more than once for the same order
const processedOrders = new Set<string>()

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")

  if (processedOrders.has(data.id)) {
    logger.warn(`order.placed duplicate skipped — Order ID: ${data.id}`)
    return
  }

  processedOrders.add(data.id)

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

  // Clean up after 5 minutes to prevent memory leak
  setTimeout(() => processedOrders.delete(data.id), 5 * 60 * 1000)
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
