import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { readText, fetchAndUpsertProduct } from "../modules/search/sync-utils"

async function handleProductUpsert({
  event,
  container,
}: SubscriberArgs<Record<string, unknown>>): Promise<void> {
  const productId = readText(event?.data?.id)
  if (!productId) return
  await fetchAndUpsertProduct(container, productId)
}

export default handleProductUpsert

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
