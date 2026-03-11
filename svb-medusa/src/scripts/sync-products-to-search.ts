import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  bulkUpsertProductsInIndex,
  configureSearchIndex,
} from "../modules/search/meilisearch-client"
import { buildSearchProduct } from "../modules/search/sync-utils"

type QueryGraphLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: { take: number; skip: number }
  }) => Promise<{ data?: unknown[]; metadata?: { count?: number } }>
}

export default async function syncProductsToSearch({ container }: ExecArgs) {
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY
  ) as QueryGraphLike

  console.log("Configuring Meilisearch index settings...")
  await configureSearchIndex()

  const BATCH_SIZE = 50
  let skip = 0
  let totalIndexed = 0

  console.log("Starting product sync to Meilisearch...")

  while (true) {
    const result = await query.graph({
      entity: "product",
      fields: [
        "id", "title", "description", "handle", "thumbnail", "status",
        "collection.title",
        "variants.prices.amount",
        "variants.prices.currency_code",
      ],
      pagination: { take: BATCH_SIZE, skip },
    })

    const products = Array.isArray(result?.data) ? result.data : []
    if (!products.length) {
      break
    }

    const searchProducts = products
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map(buildSearchProduct)
      .filter((p) => p.id)

    await bulkUpsertProductsInIndex(searchProducts)
    totalIndexed += searchProducts.length
    console.log(`Indexed ${totalIndexed} products...`)

    if (products.length < BATCH_SIZE) {
      break
    }
    skip += BATCH_SIZE
  }

  console.log(`Done. Total products indexed: ${totalIndexed}`)
}
