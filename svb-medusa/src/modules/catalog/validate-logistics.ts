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
  weight?: number | string | null
  length?: number | string | null
  width?: number | string | null
  height?: number | string | null
  metadata?: Record<string, unknown> | null
}

type CartLike = {
  id: string
  items?: Array<{
    id?: string
    variant?: VariantLike | null
  }>
}

const ALLOWED_PACKAGE_SIZES = new Set(["SMALL", "MEDIUM", "LARGE"] as const)
type PackageSize = "SMALL" | "MEDIUM" | "LARGE"
const DEFAULT_PACKAGE_SIZE: PackageSize = "SMALL"

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

function getMetadata(variant: VariantLike): Record<string, unknown> {
  const metadata = variant?.metadata
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata
  }

  return {}
}

function getDimensionsFromMetadata(metadata: Record<string, unknown>):
  | { l?: unknown; w?: unknown; h?: unknown }
  | undefined {
  const raw = metadata.dimensions_cm
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined
  }

  return raw as { l?: unknown; w?: unknown; h?: unknown }
}

function normalizePackageSize(value: unknown): PackageSize | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim().toUpperCase()
  if (!ALLOWED_PACKAGE_SIZES.has(normalized as PackageSize)) {
    return null
  }

  return normalized as PackageSize
}

export type ResolvedVariantLogistics = {
  weight_grams: number
  dimensions_cm: {
    l: number
    w: number
    h: number
  }
  package_size: PackageSize
}

export function resolveVariantLogistics(
  variant: VariantLike
): ResolvedVariantLogistics | null {
  const metadata = getMetadata(variant)
  const dimensionsFromMetadata = getDimensionsFromMetadata(metadata)

  const weightGrams =
    toPositiveNumber(metadata.weight_grams) ?? toPositiveNumber(variant.weight)
  const lengthCm =
    toPositiveNumber(dimensionsFromMetadata?.l) ?? toPositiveNumber(variant.length)
  const widthCm =
    toPositiveNumber(dimensionsFromMetadata?.w) ?? toPositiveNumber(variant.width)
  const heightCm =
    toPositiveNumber(dimensionsFromMetadata?.h) ?? toPositiveNumber(variant.height)

  if (
    weightGrams === null ||
    lengthCm === null ||
    widthCm === null ||
    heightCm === null
  ) {
    return null
  }

  const packageSize =
    normalizePackageSize(metadata.package_size) ??
    normalizePackageSize(metadata.shipping_class) ??
    DEFAULT_PACKAGE_SIZE

  return {
    weight_grams: weightGrams,
    dimensions_cm: {
      l: lengthCm,
      w: widthCm,
      h: heightCm,
    },
    package_size: packageSize,
  }
}

export function validateLogistics(variant: VariantLike): LogisticsValidationResult {
  const metadata = getMetadata(variant)
  const dimensions = getDimensionsFromMetadata(metadata)
  const missing: string[] = []

  const weightGrams =
    toPositiveNumber(metadata.weight_grams) ?? toPositiveNumber(variant.weight)
  if (weightGrams === null) {
    missing.push("weight_grams")
  }

  const lengthCm =
    toPositiveNumber(dimensions?.l) ?? toPositiveNumber(variant.length)
  if (lengthCm === null) {
    missing.push("dimensions_cm.l")
  }
  const widthCm =
    toPositiveNumber(dimensions?.w) ?? toPositiveNumber(variant.width)
  if (widthCm === null) {
    missing.push("dimensions_cm.w")
  }
  const heightCm =
    toPositiveNumber(dimensions?.h) ?? toPositiveNumber(variant.height)
  if (heightCm === null) {
    missing.push("dimensions_cm.h")
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
    fields: [
      "id",
      "items.id",
      "items.variant.id",
      "items.variant.sku",
      "items.variant.weight",
      "items.variant.length",
      "items.variant.width",
      "items.variant.height",
      "items.variant.metadata",
    ],
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
