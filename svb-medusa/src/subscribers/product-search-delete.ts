import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { deleteProductFromIndex } from "../modules/search/meilisearch-client"

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export default async function productSearchDeleteSubscriber({
  event,
}: SubscriberArgs<Record<string, unknown>>): Promise<void> {
  const productId = readText(event?.data?.id)
  if (!productId) {
    return
  }

  await deleteProductFromIndex(productId)
}

export const config: SubscriberConfig = {
  event: "product.deleted",
}
