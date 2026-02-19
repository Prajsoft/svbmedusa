import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  ProductStatus,
  QueryContext,
  getVariantAvailability,
} from "@medusajs/framework/utils"

const FEED_SALES_CHANNEL_NAME = "Feed"
const PRODUCT_PAGE_SIZE = 100

type ScopeLike = {
  resolve: (key: string) => any
}

type LoggerLike = {
  warn?: (message: string) => void
  info?: (message: string) => void
  error?: (message: string) => void
}

type QueryLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: {
      skip?: number
      take?: number
      order?: Record<string, "ASC" | "DESC">
    }
    context?: Record<string, unknown>
  }) => Promise<{
    data?: unknown
    metadata?: {
      count?: number
      skip?: number
      take?: number
    }
  }>
}

type ProductImageLike = {
  id?: string | null
  url?: string | null
}

type StockLocationAddressLike = {
  country_code?: string | null
}

type StockLocationLike = {
  id?: string | null
  name?: string | null
  address?: StockLocationAddressLike | null
}

type ProductSalesChannelLike = {
  id?: string | null
  name?: string | null
  stock_locations?: StockLocationLike[] | null
}

type CalculatedPriceLike = {
  calculated_amount?: unknown
  original_amount?: unknown
  currency_code?: string | null
}

type ProductVariantLike = {
  id: string
  title?: string | null
  sku?: string | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  calculated_price?: CalculatedPriceLike | null
  metadata?: Record<string, unknown> | null
}

type ProductLike = {
  id: string
  title?: string | null
  description?: string | null
  handle?: string | null
  thumbnail?: string | null
  status?: string | null
  images?: ProductImageLike[] | null
  variants?: ProductVariantLike[] | null
  sales_channels?: ProductSalesChannelLike[] | null
  metadata?: Record<string, unknown> | null
}

type SalesChannelLike = {
  id: string
  name?: string | null
}

export type FeedItem = {
  id: string
  title: string
  description: string
  link: string
  image_link: string
  additional_image_links: string[]
  availability: "in stock" | "out of stock"
  price: string
  sale_price?: string
  item_group_id: string
  condition?: string
  brand?: string
}

export type GetProductFeedItemsInput = {
  currency_code: string
  country_code: string
}

export type SkippedFeedVariant = {
  product_id: string
  variant_id: string
  reason: string
}

export type FeedExtractionWarning = {
  code:
    | "PRODUCT_NO_VARIANTS"
    | "VARIANT_MISSING_PRICE"
    | "MISSING_IMAGE"
    | "COUNTRY_CHANNEL_NOT_FOUND"
    | "PRODUCT_MISSING_HANDLE"
  message: string
  product_id?: string
  variant_id?: string
}

export type GetProductFeedItemsResult = {
  items: FeedItem[]
  skipped_variants: SkippedFeedVariant[]
  warnings: FeedExtractionWarning[]
}

export class ProductFeedExtractionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "ProductFeedExtractionError"
    this.code = code
  }
}

const PRODUCT_GRAPH_FIELDS = [
  "id",
  "title",
  "description",
  "handle",
  "thumbnail",
  "images.*",
  "status",
  "metadata",
  "variants.*",
  "variants.calculated_price.*",
  "variants.metadata",
  "sales_channels.*",
  "sales_channels.stock_locations.*",
  "sales_channels.stock_locations.address.*",
]

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toUpper(value: string): string {
  return readText(value).toUpperCase()
}

function toLower(value: string): string {
  return readText(value).toLowerCase()
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "")
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name]
  if (typeof rawValue !== "string") {
    return defaultValue
  }

  const normalized = rawValue.trim().toLowerCase()
  if (!normalized) {
    return defaultValue
  }

  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on"
}

function normalizeNumeric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (value && typeof value === "object") {
    if ("value" in value) {
      return normalizeNumeric((value as { value?: unknown }).value)
    }

    if ("raw" in value) {
      return normalizeNumeric((value as { raw?: unknown }).raw)
    }
  }

  return null
}

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function formatPrice(amount: number, currencyCode: string): string {
  const pricesAreMinorUnits = readBooleanEnv("PRICES_ARE_MINOR_UNITS", true)
  const normalizedAmount = pricesAreMinorUnits ? amount / 100 : amount
  return `${normalizedAmount.toFixed(2)} ${toUpper(currencyCode || "INR")}`
}

export function buildProductUrl(input: {
  storefrontUrl: string
  country_code: string
  handle: string
}): string {
  return `${normalizeBaseUrl(input.storefrontUrl)}/${toLower(input.country_code)}/products/${input.handle}`
}

function getStorefrontUrlOrThrow(): string {
  const storefrontUrl = readText(process.env.STOREFRONT_URL)
  if (!storefrontUrl) {
    throw new ProductFeedExtractionError(
      "STOREFRONT_URL_MISSING",
      "STOREFRONT_URL is required to build product feed links."
    )
  }

  return normalizeBaseUrl(storefrontUrl)
}

function warn(
  logger: LoggerLike,
  warnings: FeedExtractionWarning[],
  warning: FeedExtractionWarning
): void {
  warnings.push(warning)
  const prefix = `[product-feed] ${warning.code}`
  const message = `${prefix}: ${warning.message}`
  if (typeof logger.warn === "function") {
    logger.warn(message)
    return
  }

  // eslint-disable-next-line no-console
  console.warn(message)
}

function getImageUrls(product: ProductLike): string[] {
  const thumbnail = readText(product.thumbnail)
  const images = (product.images ?? [])
    .map((image) => readText(image?.url))
    .filter(Boolean)

  return uniq([thumbnail, ...images].filter(Boolean))
}

function getProductBrand(product: ProductLike, variant: ProductVariantLike): string | undefined {
  const variantBrand = readText(variant.metadata?.brand)
  if (variantBrand) {
    return variantBrand
  }

  const productBrand = readText(product.metadata?.brand)
  return productBrand || undefined
}

function buildFeedTitle(product: ProductLike, variant: ProductVariantLike): string {
  const productTitle = readText(product.title) || "Untitled Product"
  const variantTitle = readText(variant.title)
  if (!variantTitle || variantTitle.toLowerCase() === "default variant") {
    return productTitle
  }

  return `${productTitle} - ${variantTitle}`
}

function hasFeedSalesChannel(product: ProductLike, feedSalesChannelId: string): boolean {
  return (product.sales_channels ?? []).some(
    (channel) => readText(channel.id) === feedSalesChannelId
  )
}

function getCountryMatchedSalesChannelId(
  product: ProductLike,
  countryCode: string
): string | undefined {
  const normalizedCountryCode = toUpper(countryCode)
  for (const salesChannel of product.sales_channels ?? []) {
    const salesChannelId = readText(salesChannel.id)
    if (!salesChannelId) {
      continue
    }

    const hasCountryLocation = (salesChannel.stock_locations ?? []).some(
      (location) => toUpper(readText(location?.address?.country_code)) === normalizedCountryCode
    )

    if (hasCountryLocation) {
      return salesChannelId
    }
  }

  return undefined
}

function getVariantPriceAmount(variant: ProductVariantLike): {
  calculated: number | null
  original: number | null
  currency: string
} {
  const calculated = normalizeNumeric(variant.calculated_price?.calculated_amount)
  const original = normalizeNumeric(variant.calculated_price?.original_amount)
  const currency = toUpper(readText(variant.calculated_price?.currency_code) || "INR")

  return { calculated, original, currency }
}

async function getFeedSalesChannelOrThrow(
  query: QueryLike
): Promise<SalesChannelLike> {
  const { data } = await query.graph({
    entity: "sales_channels",
    fields: ["id", "name"],
    filters: { name: FEED_SALES_CHANNEL_NAME },
    pagination: { skip: 0, take: 1 },
  })

  const feedSalesChannel = first<SalesChannelLike>(
    Array.isArray(data) ? (data as SalesChannelLike[]) : []
  )

  if (!feedSalesChannel?.id) {
    throw new ProductFeedExtractionError(
      "FEED_SALES_CHANNEL_NOT_FOUND",
      "Sales Channel 'Feed' is required for product feed extraction."
    )
  }

  return feedSalesChannel
}

async function listPublishedProducts(
  query: QueryLike,
  input: GetProductFeedItemsInput
): Promise<ProductLike[]> {
  const products: ProductLike[] = []
  const pricingContext = {
    variants: {
      calculated_price: QueryContext({
        currency_code: toLower(input.currency_code),
        country_code: toLower(input.country_code),
      }),
    },
  }

  let skip = 0
  for (;;) {
    const { data, metadata } = await query.graph({
      entity: "product",
      fields: PRODUCT_GRAPH_FIELDS,
      filters: { status: ProductStatus.PUBLISHED },
      pagination: { skip, take: PRODUCT_PAGE_SIZE },
      context: pricingContext,
    })

    const page = Array.isArray(data) ? (data as ProductLike[]) : []
    if (!page.length) {
      break
    }

    products.push(...page)
    skip += page.length

    const total = normalizeNumeric(metadata?.count)
    if (total !== null && skip >= total) {
      break
    }

    if (page.length < PRODUCT_PAGE_SIZE) {
      break
    }
  }

  return products
}

function isVariantManagedInventory(variant: ProductVariantLike): boolean {
  return variant.manage_inventory !== false
}

export async function getProductFeedItems(
  scope: ScopeLike,
  input: GetProductFeedItemsInput
): Promise<GetProductFeedItemsResult> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  const logger = (scope.resolve(ContainerRegistrationKeys.LOGGER) ?? {}) as LoggerLike
  const storefrontUrl = getStorefrontUrlOrThrow()
  const normalizedCurrency = toUpper(input.currency_code || "INR")
  const normalizedCountry = toUpper(input.country_code || "IN")

  const warnings: FeedExtractionWarning[] = []
  const skippedVariants: SkippedFeedVariant[] = []
  const feedItems: FeedItem[] = []

  const feedSalesChannel = await getFeedSalesChannelOrThrow(query)
  const publishedProducts = await listPublishedProducts(query, input)
  const feedProducts = publishedProducts.filter((product) =>
    hasFeedSalesChannel(product, feedSalesChannel.id)
  )

  const availabilityByVariantId = new Map<string, number | null>()

  const managedVariantIdsBySalesChannel = new Map<string, string[]>()
  const selectedChannelByProductId = new Map<string, string | undefined>()
  for (const product of feedProducts) {
    const selectedSalesChannelId = getCountryMatchedSalesChannelId(
      product,
      normalizedCountry
    )
    selectedChannelByProductId.set(product.id, selectedSalesChannelId)

    if (!selectedSalesChannelId) {
      warn(logger, warnings, {
        code: "COUNTRY_CHANNEL_NOT_FOUND",
        message: `No country-matched sales channel found for product ${product.id} (${normalizedCountry}). Managed variants will be marked out of stock.`,
        product_id: product.id,
      })
      continue
    }

    const managedVariantIds = (product.variants ?? [])
      .filter((variant) => isVariantManagedInventory(variant))
      .map((variant) => variant.id)
      .filter(Boolean)

    if (!managedVariantIds.length) {
      continue
    }

    const existing = managedVariantIdsBySalesChannel.get(selectedSalesChannelId) ?? []
    managedVariantIdsBySalesChannel.set(
      selectedSalesChannelId,
      uniq([...existing, ...managedVariantIds])
    )
  }

  for (const [salesChannelId, variantIds] of managedVariantIdsBySalesChannel.entries()) {
    if (!variantIds.length) {
      continue
    }

    const availability = await getVariantAvailability(query as any, {
      variant_ids: variantIds,
      sales_channel_id: salesChannelId,
    })

    for (const variantId of variantIds) {
      availabilityByVariantId.set(variantId, availability?.[variantId]?.availability ?? null)
    }
  }

  for (const product of feedProducts) {
    const variants = product.variants ?? []
    if (!variants.length) {
      warn(logger, warnings, {
        code: "PRODUCT_NO_VARIANTS",
        message: `Product ${product.id} has no variants and was skipped.`,
        product_id: product.id,
      })
      continue
    }

    const productHandle = readText(product.handle)
    if (!productHandle) {
      warn(logger, warnings, {
        code: "PRODUCT_MISSING_HANDLE",
        message: `Product ${product.id} has no handle and was skipped.`,
        product_id: product.id,
      })
      continue
    }

    const productLink = buildProductUrl({
      storefrontUrl,
      country_code: normalizedCountry,
      handle: productHandle,
    })

    const imageUrls = getImageUrls(product)
    const imageLink = first(imageUrls) ?? ""
    const additionalImageLinks = imageUrls.slice(1)

    if (!imageLink) {
      warn(logger, warnings, {
        code: "MISSING_IMAGE",
        message: `Product ${product.id} has no thumbnail/images.`,
        product_id: product.id,
      })
    }

    const salesChannelId = selectedChannelByProductId.get(product.id)

    for (const variant of variants) {
      const variantId = readText(variant.id)
      if (!variantId) {
        continue
      }

      const priceInfo = getVariantPriceAmount(variant)
      if (priceInfo.calculated === null) {
        skippedVariants.push({
          product_id: product.id,
          variant_id: variantId,
          reason: "MISSING_CALCULATED_PRICE",
        })

        warn(logger, warnings, {
          code: "VARIANT_MISSING_PRICE",
          message: `Variant ${variantId} is missing calculated price and was skipped.`,
          product_id: product.id,
          variant_id: variantId,
        })
        continue
      }

      let availability: FeedItem["availability"] = "out of stock"
      if (!isVariantManagedInventory(variant)) {
        availability = "in stock"
      } else if (salesChannelId) {
        const availableQty = availabilityByVariantId.get(variantId)
        availability = typeof availableQty === "number" && availableQty > 0 ? "in stock" : "out of stock"
      }

      const salePrice =
        priceInfo.original !== null && priceInfo.original > priceInfo.calculated
          ? formatPrice(priceInfo.original, priceInfo.currency || normalizedCurrency)
          : undefined

      feedItems.push({
        id: variantId,
        title: buildFeedTitle(product, variant),
        description: readText(product.description),
        link: productLink,
        image_link: imageLink,
        additional_image_links: additionalImageLinks,
        availability,
        price: formatPrice(priceInfo.calculated, priceInfo.currency || normalizedCurrency),
        sale_price: salePrice,
        item_group_id: product.id,
        condition: "new",
        brand: getProductBrand(product, variant),
      })
    }
  }

  if (typeof logger.info === "function") {
    logger.info(
      `[product-feed] extracted ${feedItems.length} item(s) from ${feedProducts.length} feed product(s)`
    )
  }

  return {
    items: feedItems,
    skipped_variants: skippedVariants,
    warnings,
  }
}

export const getProductFeedItemsStep = createStep(
  "get-product-feed-items",
  async (input: GetProductFeedItemsInput, { container }) => {
    const result = await getProductFeedItems(container as unknown as ScopeLike, input)
    return new StepResponse(result)
  }
)
