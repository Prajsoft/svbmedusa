const INDEX_NAME = "products"

function readEnvText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function getConfig(): { host: string; apiKey: string } | null {
  const host = readEnvText(process.env.MEILISEARCH_HOST)
  const apiKey = readEnvText(process.env.MEILISEARCH_MASTER_KEY)
  if (!host) {
    return null
  }
  return { host, apiKey }
}

async function meiliRequest(
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  path: string,
  body?: unknown
): Promise<unknown> {
  const config = getConfig()
  if (!config) {
    return null
  }

  const url = `${config.host}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meilisearch ${method} ${path} failed (${res.status}): ${text}`)
  }

  return res.json()
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
  if (!getConfig()) return
  await meiliRequest("POST", `/indexes/${INDEX_NAME}/documents?primaryKey=id`, [product])
}

export async function deleteProductFromIndex(productId: string): Promise<void> {
  if (!getConfig()) return
  await meiliRequest("DELETE", `/indexes/${INDEX_NAME}/documents/${productId}`)
}

export async function bulkUpsertProductsInIndex(products: SearchProduct[]): Promise<void> {
  if (!getConfig() || !products.length) return
  await meiliRequest("POST", `/indexes/${INDEX_NAME}/documents?primaryKey=id`, products)
}

export async function configureSearchIndex(): Promise<void> {
  if (!getConfig()) return
  await meiliRequest("PATCH", `/indexes/${INDEX_NAME}/settings`, {
    searchableAttributes: ["title", "description", "collection_title"],
    filterableAttributes: ["status", "collection_title"],
    sortableAttributes: ["cheapest_price"],
    displayedAttributes: [
      "id", "title", "description", "handle", "thumbnail",
      "collection_title", "status", "cheapest_price", "currency_code",
    ],
  })
}
