import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

const STOREFRONT_URL = process.env.STOREFRONT_URL || "http://localhost:8000"
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET

export default async function revalidateStorefrontHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")

  if (!REVALIDATE_SECRET) {
    logger.warn("REVALIDATE_SECRET not set, skipping storefront revalidation")
    return
  }

  logger.info(
    `Revalidating storefront cache — event: ${event.name}, id: ${event.data.id}`
  )

  try {
    const res = await fetch(`${STOREFRONT_URL}/api/revalidate`, {
      method: "POST",
      headers: {
        "x-revalidate-secret": REVALIDATE_SECRET,
      },
    })

    if (!res.ok) {
      logger.error(`Storefront revalidation failed: ${res.status}`)
      return
    }

    logger.info("Storefront cache revalidated successfully")
  } catch (error) {
    logger.error("Failed to revalidate storefront cache", error as Error)
  }
}

export const config: SubscriberConfig = {
  event: [
    "product.created",
    "product.updated",
    "product.deleted",
    "collection.created",
    "collection.updated",
    "collection.deleted",
  ],
}
