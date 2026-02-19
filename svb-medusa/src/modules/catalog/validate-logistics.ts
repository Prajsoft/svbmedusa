import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { AppError, validationError } from "../observability/errors"

export type LogisticsValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string }

type ScopeLike = {
  resolve: (key: string) => any
}

type VariantLike = {
  id?: string
  sku?: string | null
  metadata?: Record<string, unknown> | null
}

type CartLike = {
  id: string
  items?: Array<{
    id?: string
    variant?: VariantLike | null
  }>
}

const ALLOWED_SHIPPING_CLASSES = new Set(["SMALL", "MEDIUM", "LARGE"])

export class LogisticsValidationError extends AppError {
  constructor(message: string) {
    const appError = validationError("MISSING_LOGISTICS_METADATA", message)
    super({
      code: appError.code,
      message: appError.message,
      category: appError.category,
      httpStatus: appError.httpStatus,
      details: appError.details,
    })
    this.name = "LogisticsValidationError"
  }
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

function skuOf(variant: VariantLike): string {
  return variant.sku || variant.id || "unknown"
}

export function validateLogistics(variant: VariantLike): LogisticsValidationResult {
  const metadata = variant?.metadata ?? {}
  const missing: string[] = []

  if (toPositiveNumber(metadata.weight_grams) === null) {
    missing.push("weight_grams")
  }

  const dimensions = metadata.dimensions_cm as
    | { l?: unknown; w?: unknown; h?: unknown }
    | undefined
  if (!dimensions || toPositiveNumber(dimensions.l) === null) {
    missing.push("dimensions_cm.l")
  }
  if (!dimensions || toPositiveNumber(dimensions.w) === null) {
    missing.push("dimensions_cm.w")
  }
  if (!dimensions || toPositiveNumber(dimensions.h) === null) {
    missing.push("dimensions_cm.h")
  }

  const shippingClassRaw = metadata.shipping_class
  const shippingClass =
    typeof shippingClassRaw === "string" ? shippingClassRaw.toUpperCase() : ""
  if (!ALLOWED_SHIPPING_CLASSES.has(shippingClass)) {
    missing.push("shipping_class")
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: "MISSING_LOGISTICS_METADATA",
      message: `SKU ${skuOf(variant)} is missing logistics metadata: ${missing.join(", ")}`,
    }
  }

  return { ok: true }
}

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

async function getCart(scope: ScopeLike, cartId: string): Promise<CartLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "items.id", "items.variant.id", "items.variant.sku", "items.variant.metadata"],
    filters: { id: cartId },
  })

  const cart = first<CartLike>(data)
  if (!cart) {
    throw new Error(`Cart ${cartId} not found`)
  }

  return cart
}

export async function validateCartLogistics(
  scope: ScopeLike,
  cartId: string
): Promise<void> {
  const cart = await getCart(scope, cartId)

  for (const item of cart.items ?? []) {
    const variant = item.variant
    if (!variant) {
      continue
    }

    const result = validateLogistics(variant)
    if (!result.ok) {
      throw new LogisticsValidationError(result.message)
    }
  }
}
