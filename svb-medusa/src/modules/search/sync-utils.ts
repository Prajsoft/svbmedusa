import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { upsertProductInIndex, type SearchProduct } from "./meilisearch-client"

// Currency to index prices for. Defaults to INR for SVB Sports (India-only store).
// Override with MEILISEARCH_PRICE_CURRENCY env var for other regions.
const PRICE_CURRENCY = (
  process.env.MEILISEARCH_PRICE_CURRENCY ?? "inr"
).toLowerCase()

type QueryGraphLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

export function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function buildSearchProduct(raw: Record<string, unknown>): SearchProduct {
  const collection =
    raw.collection && typeof raw.collection === "object"
      ? (raw.collection as Record<string, unknown>)
      : null

  const variants = Array.isArray(raw.variants) ? raw.variants : []
  let cheapestPrice: number | null = null
  let currencyCode: string | null = null

  for (const variant of variants) {
    if (!variant || typeof variant !== "object") continue
    const prices = Array.isArray((variant as any).prices)
      ? (variant as any).prices
      : []
    for (const price of prices) {
      if (!price || typeof price !== "object") continue
      const code = readText((price as any).currency_code).toLowerCase()
      if (code !== PRICE_CURRENCY) continue
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

export async function fetchAndUpsertProduct(
  container: unknown,
  productId: string
): Promise<void> {
  const query = (container as any)?.resolve?.(
    ContainerRegistrationKeys.QUERY
  ) as QueryGraphLike | undefined

  if (!query) return

  const result = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "description",
      "handle",
      "thumbnail",
      "status",
      "collection.title",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
    filters: { id: productId },
  })

  const raw = Array.isArray(result?.data) ? result.data[0] : null
  if (!raw || typeof raw !== "object") return

  const product = buildSearchProduct(raw as Record<string, unknown>)
  if (!product.id) return

  await upsertProductInIndex(product)
}
