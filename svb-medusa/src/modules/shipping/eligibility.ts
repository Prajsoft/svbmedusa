import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { AppError, validationError } from "../observability/errors"

type ScopeLike = {
  resolve: (key: string) => any
}

type ShippingOptionLike = {
  id?: string
  name?: string | null
  code?: string | null
  type?: { code?: string | null; label?: string | null } | null
  metadata?: Record<string, unknown> | null
}

type CartLike = {
  id: string
  items?: Array<{
    variant?: {
      id?: string
      sku?: string | null
      metadata?: Record<string, unknown> | null
    } | null
  }>
}

type Eligibility = {
  codEligible: boolean
}

export type CartShippingProfile = {
  shippingClasses: string[]
  itemCodEligibility: boolean[]
  allItemsCodEligible: boolean
}

type ShippingOptionEligibility =
  | { ok: true }
  | { ok: false; reason: string }

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

function readShippingClass(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }

  return value.trim().toUpperCase()
}

export const COD_ELIGIBLE_METADATA_KEY = "cod_eligible"

function readCodEligible(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true"
  }

  return false
}

export class ShippingOptionIneligibleError extends AppError {
  constructor(reason: string) {
    const appError = validationError("SHIPPING_OPTION_INELIGIBLE", reason)
    super({
      code: appError.code,
      message: appError.message,
      category: appError.category,
      httpStatus: appError.httpStatus,
      details: appError.details,
    })
    this.name = "ShippingOptionIneligibleError"
  }
}

export function getCartShippingProfile(cart: CartLike): CartShippingProfile {
  const shippingClasses = (cart.items ?? [])
    .map((item) => readShippingClass(item.variant?.metadata?.shipping_class))
    .filter(Boolean)
  const itemCodEligibility = (cart.items ?? []).map((item) =>
    readCodEligible(item.variant?.metadata?.[COD_ELIGIBLE_METADATA_KEY])
  )

  return {
    shippingClasses,
    itemCodEligibility,
    allItemsCodEligible:
      itemCodEligibility.length > 0 && itemCodEligibility.every((value) => value),
  }
}

export function getCartShippingEligibility(cart: CartLike): Eligibility {
  const profile = getCartShippingProfile(cart)
  return { codEligible: profile.allItemsCodEligible }
}

export function isCodOption(option: ShippingOptionLike): boolean {
  const raw = [
    option.name,
    option.code,
    option.type?.code,
    option.type?.label,
    option.metadata?.code,
    option.metadata?.payment_method,
    option.metadata?.payment_type,
  ]
    .filter((v) => typeof v === "string")
    .map((v) => String(v).toLowerCase())
    .join(" ")

  return raw.includes("cod") || raw.includes("cash on delivery")
}

export function isShippingOptionEligible(
  cartProfile: CartShippingProfile,
  shippingOption: ShippingOptionLike
): ShippingOptionEligibility {
  if (isCodOption(shippingOption) && !cartProfile.allItemsCodEligible) {
    return {
      ok: false,
      reason: "COD allowed only when all cart variants have metadata.cod_eligible=true",
    }
  }

  return { ok: true }
}

export function filterShippingOptionsByEligibility(
  shippingOptions: ShippingOptionLike[],
  eligibility: Eligibility
): ShippingOptionLike[] {
  const cartProfile: CartShippingProfile = {
    shippingClasses: [],
    itemCodEligibility: [],
    allItemsCodEligible: eligibility.codEligible,
  }

  return shippingOptions.filter((option) => {
    const result = isShippingOptionEligible(cartProfile, option)
    return result.ok
  })
}

async function getCart(scope: ScopeLike, cartId: string): Promise<CartLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "items.variant.id", "items.variant.sku", "items.variant.metadata"],
    filters: { id: cartId },
  })

  const cart = first<CartLike>(data)
  if (!cart) {
    throw new Error(`Cart ${cartId} not found`)
  }

  return cart
}

export async function filterShippingOptionsForCart(
  scope: ScopeLike,
  cartId: string,
  shippingOptions: ShippingOptionLike[]
): Promise<ShippingOptionLike[]> {
  const cart = await getCart(scope, cartId)
  const cartProfile = getCartShippingProfile(cart)

  return shippingOptions.filter((option) => {
    const result = isShippingOptionEligible(cartProfile, option)
    return result.ok
  })
}

async function getShippingOption(
  scope: ScopeLike,
  shippingOptionId: string
): Promise<ShippingOptionLike | undefined> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "metadata"],
    filters: { id: shippingOptionId },
  })

  return first<ShippingOptionLike>(data)
}

export async function validateSelectedShippingOptionForCart(
  scope: ScopeLike,
  cartId: string,
  shippingOptionId: string
): Promise<void> {
  const [cart, shippingOption] = await Promise.all([
    getCart(scope, cartId),
    getShippingOption(scope, shippingOptionId),
  ])

  if (!shippingOption) {
    return
  }

  const cartProfile = getCartShippingProfile(cart)
  const eligibility = isShippingOptionEligible(cartProfile, shippingOption)

  if (!eligibility.ok) {
    throw new ShippingOptionIneligibleError(eligibility.reason)
  }
}
