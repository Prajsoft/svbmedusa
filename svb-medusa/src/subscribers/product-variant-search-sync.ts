import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { readText, fetchAndUpsertProduct } from "../modules/search/sync-utils"

// When a variant changes (price, stock, etc.) re-index the parent product
// so search always reflects the latest cheapest price.
async function handleVariantChange({
  event,
  container,
}: SubscriberArgs<Record<string, unknown>>): Promise<void> {
  const productId = readText(event?.data?.product_id)
  if (!productId) return
  await fetchAndUpsertProduct(container, productId)
}

export default handleVariantChange

export const config: SubscriberConfig = {
  event: [
    "product-variant.created",
    "product-variant.updated",
    "product-variant.deleted",
  ],
}
