import { AppError, integrityError } from "../observability/errors"

type NumberLike = number | string | null | undefined

type CartLineItemLike = {
  id?: string
  subtotal?: NumberLike
  discount_total?: NumberLike
}

type CartShippingMethodLike = {
  id?: string
  total?: NumberLike
  subtotal?: NumberLike
  discount_total?: NumberLike
  original_total?: NumberLike
  original_subtotal?: NumberLike
}

export type CartTotalsLike = {
  grand_total?: NumberLike
  id?: string
  total?: NumberLike
  subtotal?: NumberLike
  discount_total?: NumberLike
  shipping_total?: NumberLike
  original_shipping_total?: NumberLike
  shipping_discount_total?: NumberLike
  items?: CartLineItemLike[] | null
  shipping_methods?: CartShippingMethodLike[] | null
}

const EPSILON = 0.01

export class PriceIntegrityError extends AppError {
  constructor(message: string) {
    const appError = integrityError("PRICE_INTEGRITY_VIOLATION", message)
    super({
      code: appError.code,
      message: appError.message,
      category: appError.category,
      httpStatus: appError.httpStatus,
      details: appError.details,
    })
    this.name = "PriceIntegrityError"
  }
}

function toNumber(value: NumberLike): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function assertNonNegative(field: string, value: number): void {
  if (value < -EPSILON) {
    throw new PriceIntegrityError(
      `Price integrity violation: ${field} cannot be negative.`
    )
  }
}

function getShippingDiscount(totals: CartTotalsLike): number {
  const explicitShippingDiscount = Math.abs(toNumber(totals.shipping_discount_total))
  if (explicitShippingDiscount > 0) {
    return explicitShippingDiscount
  }

  const originalShippingTotal = toNumber(totals.original_shipping_total)
  const shippingTotal = toNumber(totals.shipping_total)

  if (originalShippingTotal > 0 || shippingTotal > 0) {
    return Math.max(0, originalShippingTotal - shippingTotal)
  }

  const shippingMethods = Array.isArray(totals.shipping_methods)
    ? totals.shipping_methods
    : []

  return shippingMethods.reduce((sum, method) => {
    const methodOriginalTotal = toNumber(method.original_total)
    const methodTotal = toNumber(method.total)

    if (methodOriginalTotal > 0 || methodTotal > 0) {
      return sum + Math.max(0, methodOriginalTotal - methodTotal)
    }

    const methodOriginalSubtotal = toNumber(method.original_subtotal)
    const methodSubtotal = toNumber(method.subtotal)
    if (methodOriginalSubtotal > 0 || methodSubtotal > 0) {
      return sum + Math.max(0, methodOriginalSubtotal - methodSubtotal)
    }

    return sum + Math.max(0, toNumber(method.discount_total))
  }, 0)
}

function assertLineLevelDiscounts(totals: CartTotalsLike): void {
  const items = Array.isArray(totals.items) ? totals.items : []

  for (const item of items) {
    const lineSubtotal = toNumber(item.subtotal)
    const lineDiscount = Math.abs(toNumber(item.discount_total))

    assertNonNegative("line item subtotal", lineSubtotal)

    if (lineDiscount - lineSubtotal > EPSILON) {
      throw new PriceIntegrityError(
        `Price integrity violation: discount exceeds subtotal for line item ${item.id ?? "unknown"}.`
      )
    }
  }
}

/**
 * Enforces v1 promotion price integrity with Medusa-computed totals.
 * Rule: discount cannot exceed subtotal, except shipping discounts are allowed
 * up to shipping cost; equivalent upper bound is subtotal + shipping_discount.
 */
export function enforcePriceIntegrity(totals: CartTotalsLike): void {
  const grandTotalRaw =
    totals.grand_total !== undefined ? totals.grand_total : totals.total
  const grandTotal = toNumber(grandTotalRaw)
  const subtotal = toNumber(totals.subtotal)
  const discountTotal = Math.abs(toNumber(totals.discount_total))
  const shippingTotal = toNumber(totals.shipping_total)
  const originalShippingTotal = toNumber(totals.original_shipping_total)
  const shippingDiscount = getShippingDiscount(totals)
  const itemDiscount = Math.max(0, discountTotal - shippingDiscount)

  assertNonNegative("grand_total", grandTotal)
  assertNonNegative("subtotal", subtotal)
  assertNonNegative("shipping_total", shippingTotal)
  assertNonNegative("original_shipping_total", originalShippingTotal)

  if (itemDiscount - subtotal > EPSILON) {
    throw new PriceIntegrityError(
      "Price integrity violation: discount exceeds subtotal."
    )
  }

  const maxShippingCost = Math.max(originalShippingTotal, shippingTotal)
  if (shippingDiscount - maxShippingCost > EPSILON) {
    throw new PriceIntegrityError(
      "Price integrity violation: shipping discount exceeds shipping cost."
    )
  }

  assertLineLevelDiscounts(totals)
}

export const ensureCartPriceIntegrity = enforcePriceIntegrity
