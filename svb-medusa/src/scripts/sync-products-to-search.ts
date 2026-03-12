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

  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

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

    // Fetch sports_attributes for this batch in one query.
    // The column is raw JSONB and not part of the Medusa query graph.
    const productIds = products
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => (p as Record<string, unknown>).id)
      .filter(Boolean)

    const saRows: Array<{ id: string; sports_attributes: unknown }> =
      productIds.length
        ? await pgConnection("product")
            .select("id", "sports_attributes")
            .whereIn("id", productIds as string[])
            .whereNull("deleted_at")
        : []

    const saMap = new Map(saRows.map((r) => [r.id, r.sports_attributes]))

    const searchProducts = products
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => {
        const withSa = {
          ...p,
          sports_attributes: saMap.get((p as Record<string, unknown>).id as string) ?? null,
        }
        return buildSearchProduct(withSa)
      })
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
