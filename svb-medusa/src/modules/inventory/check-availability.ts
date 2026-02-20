import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { AppError, validationError } from "../observability/errors"

export const WAREHOUSE_NAME = "WH-MRT-01"

type ScopeLike = {
  resolve: (key: string) => any
}

type CartLike = {
  id: string
  sales_channel_id?: string | null
  items?: Array<{
    id: string
    variant_id?: string | null
    quantity?: number | null
  }>
}

type VariantInventoryLike = {
  inventory_item_id?: string | null
  required_quantity?: number | null
  inventory?: {
    location_levels?: Array<{
      location_id?: string | null
      stock_locations?: {
        id?: string | null
        name?: string | null
        sales_channels?: Array<{ id?: string | null }>
      } | null
    }>
  } | null
}

type VariantLike = {
  id: string
  sku?: string | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_items?: VariantInventoryLike[]
}

export class OutOfStockError extends AppError {
  constructor(sku: string) {
    const appError = validationError(
      "OUT_OF_STOCK",
      `Insufficient inventory for SKU ${sku} at ${WAREHOUSE_NAME}`
    )
    super({
      code: appError.code,
      message: appError.message,
      category: appError.category,
      httpStatus: appError.httpStatus,
      details: appError.details,
    })
    this.name = "OutOfStockError"
  }
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(String(value))
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function first<T>(data: T[] | T | undefined | null): T | undefined {
  if (!data) {
    return undefined
  }

  return Array.isArray(data) ? data[0] : data
}

async function getCart(scope: ScopeLike, cartId: string): Promise<CartLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "sales_channel_id", "items.id", "items.variant_id", "items.quantity"],
    filters: { id: cartId },
  })

  const cart = first<CartLike>(data)
  if (!cart) {
    throw new Error(`Cart ${cartId} not found`)
  }

  return cart
}

async function getVariant(scope: ScopeLike, variantId: string): Promise<VariantLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "sku",
      "manage_inventory",
      "allow_backorder",
      "inventory_items.inventory_item_id",
      "inventory_items.required_quantity",
      "inventory_items.inventory.location_levels.location_id",
      "inventory_items.inventory.location_levels.stock_locations.id",
      "inventory_items.inventory.location_levels.stock_locations.name",
      "inventory_items.inventory.location_levels.stock_locations.sales_channels.id",
    ],
    filters: { id: variantId },
  })

  const variant = first<VariantLike>(data)
  if (!variant) {
    throw new Error(`Variant ${variantId} not found`)
  }

  return variant
}

function getWarehouseLocationId(
  variant: VariantLike,
  salesChannelId?: string | null
): string | undefined {
  for (const item of variant.inventory_items ?? []) {
    for (const level of item.inventory?.location_levels ?? []) {
      const stockLocation = level.stock_locations
      if (!stockLocation) {
        continue
      }

      const nameMatches = stockLocation.name === WAREHOUSE_NAME
      if (!nameMatches) {
        continue
      }

      const channelIds = (stockLocation.sales_channels ?? [])
        .map((channel) => channel.id)
        .filter(Boolean)

      if (salesChannelId && channelIds.length > 0 && !channelIds.includes(salesChannelId)) {
        continue
      }

      return stockLocation.id ?? level.location_id ?? undefined
    }
  }

  return undefined
}

async function getAvailableQuantityForVariantAtWarehouse(
  scope: ScopeLike,
  variant: VariantLike,
  salesChannelId?: string | null
): Promise<number> {
  const inventoryService = scope.resolve(Modules.INVENTORY)
  const locationId = getWarehouseLocationId(variant, salesChannelId)

  if (!locationId) {
    return 0
  }

  const inventoryItems = variant.inventory_items ?? []
  if (!inventoryItems.length) {
    return 0
  }

  let availableUnits = Number.POSITIVE_INFINITY

  for (const item of inventoryItems) {
    const inventoryItemId = item.inventory_item_id ?? undefined
    const requiredQuantity = Math.max(1, toNumber(item.required_quantity ?? 1))

    if (!inventoryItemId) {
      availableUnits = 0
      continue
    }

    const availableRaw = await inventoryService.retrieveAvailableQuantity(
      inventoryItemId,
      [locationId]
    )
    const availableQuantity = toNumber(availableRaw)
    const maxUnitsFromItem = Math.floor(availableQuantity / requiredQuantity)

    availableUnits = Math.min(availableUnits, maxUnitsFromItem)
  }

  return Number.isFinite(availableUnits) ? Math.max(0, availableUnits) : 0
}

async function assertVariantQuantityAvailable(
  scope: ScopeLike,
  cart: CartLike,
  variantId: string,
  requestedQuantity: number
): Promise<void> {
  const variant = await getVariant(scope, variantId)

  // Variants that do not track inventory (or explicitly allow backorders)
  // should not be blocked by sellable stock checks.
  if (variant.manage_inventory === false || variant.allow_backorder === true) {
    return
  }

  const sku = variant.sku || variant.id
  const available = await getAvailableQuantityForVariantAtWarehouse(
    scope,
    variant,
    cart.sales_channel_id
  )

  if (requestedQuantity > available) {
    throw new OutOfStockError(sku)
  }
}

export async function checkAvailabilityForAddToCart(
  scope: ScopeLike,
  cartId: string,
  variantId: string,
  quantityToAdd: number
): Promise<void> {
  if (!Number.isFinite(quantityToAdd) || quantityToAdd <= 0) {
    return
  }

  const cart = await getCart(scope, cartId)
  const existingQuantity = (cart.items ?? [])
    .filter((item) => item.variant_id === variantId)
    .reduce((sum, item) => sum + toNumber(item.quantity ?? 0), 0)

  const requestedQuantity = existingQuantity + quantityToAdd
  await assertVariantQuantityAvailable(scope, cart, variantId, requestedQuantity)
}

export async function checkAvailabilityForUpdateCartLineItem(
  scope: ScopeLike,
  cartId: string,
  lineItemId: string,
  nextQuantity: number
): Promise<void> {
  if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
    return
  }

  const cart = await getCart(scope, cartId)
  const lineItem = (cart.items ?? []).find((item) => item.id === lineItemId)

  if (!lineItem?.variant_id) {
    throw new Error(`Line item ${lineItemId} not found in cart ${cartId}`)
  }

  const currentQuantity = toNumber(lineItem.quantity ?? 0)
  if (nextQuantity <= currentQuantity) {
    return
  }

  await assertVariantQuantityAvailable(scope, cart, lineItem.variant_id, nextQuantity)
}

export async function checkAvailabilityForCompleteCart(
  scope: ScopeLike,
  cartId: string
): Promise<void> {
  const cart = await getCart(scope, cartId)
  const quantitiesByVariant = new Map<string, number>()

  for (const item of cart.items ?? []) {
    if (!item.variant_id) {
      continue
    }

    const next = (quantitiesByVariant.get(item.variant_id) ?? 0) + toNumber(item.quantity ?? 0)
    quantitiesByVariant.set(item.variant_id, next)
  }

  for (const [variantId, quantity] of quantitiesByVariant.entries()) {
    if (quantity <= 0) {
      continue
    }

    await assertVariantQuantityAvailable(scope, cart, variantId, quantity)
  }
}
