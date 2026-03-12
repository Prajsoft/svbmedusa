import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { upsertProductInIndex, type SearchProduct } from "./meilisearch-client"

// ── Sports-attributes flattener ───────────────────────────────────────────────
// Converts the nested JSONB shape into flat sa_* keys for MeiliSearch.
// Empty strings, empty arrays, null, and undefined are omitted so sparse
// documents stay lean (only meaningful attributes are indexed).

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false
  if (typeof value === "string") return value.trim() !== ""
  if (Array.isArray(value)) return value.length > 0
  return true
}

export function flattenSportsAttributes(
  sportsAttrs: unknown
): Record<string, unknown> {
  if (!sportsAttrs || typeof sportsAttrs !== "object") return {}

  const attrs = sportsAttrs as Record<string, unknown>
  const flat: Record<string, unknown> = {}

  // Top-level: sport
  if (isNonEmpty(attrs.sport)) flat["sa_sport"] = attrs.sport

  // Common attributes
  const common = attrs.common
  if (common && typeof common === "object") {
    for (const [key, value] of Object.entries(
      common as Record<string, unknown>
    )) {
      // Skip boolean false — those are "not set" defaults in the admin widget
      if (isNonEmpty(value)) flat[`sa_${key}`] = value
    }
  }

  // Sport-specific attributes
  const specific = attrs.sport_specific
  if (specific && typeof specific === "object") {
    for (const [key, value] of Object.entries(
      specific as Record<string, unknown>
    )) {
      if (isNonEmpty(value)) flat[`sa_${key}`] = value
    }
  }

  return flat
}

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

  const saFields = flattenSportsAttributes(raw.sports_attributes)

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
    ...saFields,
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

  // Fetch core product fields via the Medusa query graph
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

  // Fetch sports_attributes separately — it's a raw JSONB column not part of
  // the Medusa query graph (the product entity is owned by @medusajs/product).
  try {
    const pgConnection = (container as any)?.resolve?.(
      ContainerRegistrationKeys.PG_CONNECTION
    )
    if (pgConnection) {
      const [row] = await pgConnection("product")
        .select("sports_attributes")
        .where("id", productId)
        .whereNull("deleted_at")
        .limit(1)
      if (row) {
        ;(raw as Record<string, unknown>).sports_attributes =
          row.sports_attributes ?? null
      }
    }
  } catch {
    // Non-fatal: sports_attributes simply won't be indexed for this product
  }

  const product = buildSearchProduct(raw as Record<string, unknown>)
  if (!product.id) return

  await upsertProductInIndex(product)
}
