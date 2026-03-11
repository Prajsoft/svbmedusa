import { MeiliSearch } from "meilisearch"

const INDEX_NAME = "products"

function readEnvText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function getMeilisearchClient(): MeiliSearch | null {
  const host = readEnvText(process.env.MEILISEARCH_HOST)
  const apiKey = readEnvText(process.env.MEILISEARCH_MASTER_KEY)

  if (!host) {
    return null
  }

  return new MeiliSearch({ host, apiKey })
}

export type SearchProduct = {
  id: string
  title: string
  description: string | null
  handle: string
  thumbnail: string | null
  collection_title: string | null
  status: string
  cheapest_price: number | null
  currency_code: string | null
}

export async function upsertProductInIndex(product: SearchProduct): Promise<void> {
  const client = getMeilisearchClient()
  if (!client) {
    return
  }

  const index = client.index(INDEX_NAME)
  await index.addDocuments([product], { primaryKey: "id" })
}

export async function deleteProductFromIndex(productId: string): Promise<void> {
  const client = getMeilisearchClient()
  if (!client) {
    return
  }

  const index = client.index(INDEX_NAME)
  await index.deleteDocument(productId)
}

export async function bulkUpsertProductsInIndex(products: SearchProduct[]): Promise<void> {
  const client = getMeilisearchClient()
  if (!client || !products.length) {
    return
  }

  const index = client.index(INDEX_NAME)
  await index.addDocuments(products, { primaryKey: "id" })
}

export async function configureSearchIndex(): Promise<void> {
  const client = getMeilisearchClient()
  if (!client) {
    return
  }

  const index = client.index(INDEX_NAME)
  await index.updateSearchableAttributes(["title", "description", "collection_title"])
  await index.updateFilterableAttributes(["status", "collection_title"])
  await index.updateSortableAttributes(["cheapest_price"])
  await index.updateDisplayedAttributes([
    "id", "title", "description", "handle", "thumbnail",
    "collection_title", "status", "cheapest_price", "currency_code",
  ])
}
