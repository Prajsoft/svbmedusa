import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  bulkUpsertProductsInIndex,
  configureSearchIndex,
  type SearchProduct,
} from "../modules/search/meilisearch-client"

type QueryGraphLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: { take: number; skip: number }
  }) => Promise<{ data?: unknown[]; metadata?: { count?: number } }>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function buildSearchProduct(raw: Record<string, unknown>): SearchProduct {
  const collection =
    raw.collection && typeof raw.collection === "object"
      ? (raw.collection as Record<string, unknown>)
      : null

  const variants = Array.isArray(raw.variants) ? raw.variants : []
  let cheapestPrice: number | null = null
  let currencyCode: string | null = null

  for (const variant of variants) {
    if (!variant || typeof variant !== "object") continue
    const prices = Array.isArray((variant as any).prices) ? (variant as any).prices : []
    for (const price of prices) {
      if (!price || typeof price !== "object") continue
      const amount = toNumber((price as any).amount)
      if (amount !== null && (cheapestPrice === null || amount < cheapestPrice)) {
        cheapestPrice = amount
        currencyCode = readText((price as any).currency_code) || null
      }
    }
  }

  return {
    id: readText(raw.id),
    title: readText(raw.title),
    description: readText(raw.description) || null,
    handle: readText(raw.handle),
    thumbnail: readText(raw.thumbnail) || null,
    collection_title: collection ? readText(collection.title) || null : null,
    status: readText(raw.status) || "draft",
    cheapest_price: cheapestPrice,
    currency_code: currencyCode,
  }
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
