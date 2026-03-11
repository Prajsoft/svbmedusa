import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  upsertProductInIndex,
  deleteProductFromIndex,
  type SearchProduct,
} from "../modules/search/meilisearch-client"

type QueryGraphLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function buildSearchProduct(raw: Record<string, unknown>): SearchProduct {
  const collection = raw.collection && typeof raw.collection === "object"
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

async function fetchProduct(
  container: unknown,
  productId: string
): Promise<SearchProduct | null> {
  const query = (container as any)?.resolve?.(
    ContainerRegistrationKeys.QUERY
  ) as QueryGraphLike | undefined

  if (!query) {
    return null
  }

  const result = await query.graph({
    entity: "product",
    fields: [
      "id", "title", "description", "handle", "thumbnail", "status",
      "collection.title",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
    filters: { id: productId },
  })

  const product = Array.isArray(result?.data) ? result.data[0] : null
  if (!product || typeof product !== "object") {
    return null
  }

  return buildSearchProduct(product as Record<string, unknown>)
}

async function handleProductUpsert({
  event,
  container,
}: SubscriberArgs<Record<string, unknown>>): Promise<void> {
  const productId = readText(event?.data?.id)
  if (!productId) {
    return
  }

  const product = await fetchProduct(container, productId)
  if (!product) {
    return
  }

  await upsertProductInIndex(product)
}

async function handleProductDelete({
  event,
}: SubscriberArgs<Record<string, unknown>>): Promise<void> {
  const productId = readText(event?.data?.id)
  if (!productId) {
    return
  }

  await deleteProductFromIndex(productId)
}

export const productCreatedHandler = handleProductUpsert
export const productUpdatedHandler = handleProductUpsert
export const productDeletedHandler = handleProductDelete

export default handleProductUpsert

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
