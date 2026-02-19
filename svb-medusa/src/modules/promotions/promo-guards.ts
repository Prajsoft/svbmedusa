import { promoPolicy } from "./promo-policy"

type PromotionLike = {
  code?: string | null
  is_automatic?: boolean | null
  type?: string | null
  target_type?: string | null
  campaign?: {
    type?: string | null
  } | null
  application_method?: {
    type?: string | null
    target_type?: string | null
  } | null
  metadata?: Record<string, unknown> | null
}

type DiscountCodeLike = {
  code?: string | null
  is_automatic?: boolean | null
  type?: string | null
  target_type?: string | null
  metadata?: Record<string, unknown> | null
}

type CartLike = {
  coupon_code?: string | null
  promotions?: PromotionLike[] | null
  discount_codes?: DiscountCodeLike[] | null
}

export class PromoGuardError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "PromoGuardError"
    this.code = code
  }
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeKind(value: unknown): string {
  return readString(value).toLowerCase()
}

function isAutomaticEntry(entry: {
  is_automatic?: unknown
  type?: unknown
  campaign?: { type?: unknown } | null
  metadata?: Record<string, unknown> | null
}): boolean {
  if (entry.is_automatic === true) {
    return true
  }

  const type = normalizeKind(entry.type)
  const campaignType = normalizeKind(entry.campaign?.type)
  const metadataType = normalizeKind(entry.metadata?.type)
  const metadataSource = normalizeKind(entry.metadata?.source)

  return (
    type === "automatic" ||
    campaignType === "automatic" ||
    metadataType === "automatic" ||
    metadataSource === "automatic"
  )
}

function getPromoEntries(cart: CartLike): PromotionLike[] {
  return Array.isArray(cart.promotions) ? cart.promotions : []
}

function getDiscountCodeEntries(cart: CartLike): DiscountCodeLike[] {
  return Array.isArray(cart.discount_codes) ? cart.discount_codes : []
}

function getExistingManualCouponCodes(cart: CartLike): string[] {
  const codes = new Set<string>()

  const cartCouponCode = readString(cart.coupon_code)
  if (cartCouponCode) {
    codes.add(normalizeCode(cartCouponCode))
  }

  for (const discountCode of getDiscountCodeEntries(cart)) {
    const code = readString(discountCode.code)
    if (!code) {
      continue
    }

    if (!isAutomaticEntry(discountCode)) {
      codes.add(normalizeCode(code))
    }
  }

  for (const promotion of getPromoEntries(cart)) {
    const code = readString(promotion.code)
    if (!code) {
      continue
    }

    if (!isAutomaticEntry(promotion)) {
      codes.add(normalizeCode(code))
    }
  }

  return Array.from(codes)
}

function hasAutomaticPromotion(cart: CartLike): boolean {
  return (
    getPromoEntries(cart).some((promotion) => isAutomaticEntry(promotion)) ||
    getDiscountCodeEntries(cart).some((discountCode) => isAutomaticEntry(discountCode))
  )
}

function isFreeShippingCandidateEntry(entry: {
  type?: unknown
  target_type?: unknown
  application_method?: { type?: unknown; target_type?: unknown } | null
  metadata?: Record<string, unknown> | null
}): boolean {
  const type = normalizeKind(entry.type)
  const targetType = normalizeKind(entry.target_type)
  const appType = normalizeKind(entry.application_method?.type)
  const appTargetType = normalizeKind(entry.application_method?.target_type)
  const metadataScope = normalizeKind(entry.metadata?.discount_scope)
  const metadataType = normalizeKind(entry.metadata?.type)
  const metadataTarget = normalizeKind(entry.metadata?.target_type)
  const isFreeShippingFlag = entry.metadata?.is_free_shipping === true

  return (
    type === "free_shipping" ||
    appType === "shipping" ||
    targetType === "shipping" ||
    appTargetType === "shipping" ||
    metadataScope === "shipping" ||
    metadataType === "free_shipping" ||
    metadataTarget === "shipping" ||
    isFreeShippingFlag
  )
}

function isFreeShippingCoupon(cart: CartLike, incomingCouponCode: string): boolean {
  const normalizedIncoming = normalizeCode(incomingCouponCode)
  const freeShipByCodeName = /(FREE[_-]?SHIP|FREESHIP|SHIPFREE)/i.test(
    normalizedIncoming
  )

  if (freeShipByCodeName) {
    return true
  }

  const matchingPromo = getPromoEntries(cart).find((entry) => {
    const code = readString(entry.code)
    return code && normalizeCode(code) === normalizedIncoming
  })

  if (matchingPromo && isFreeShippingCandidateEntry(matchingPromo)) {
    return true
  }

  const matchingDiscount = getDiscountCodeEntries(cart).find((entry) => {
    const code = readString(entry.code)
    return code && normalizeCode(code) === normalizedIncoming
  })

  if (matchingDiscount && isFreeShippingCandidateEntry(matchingDiscount)) {
    return true
  }

  return false
}

export function ensureCouponStackingAllowed(
  cart: CartLike,
  incomingCouponCode: string
): void {
  const normalizedIncoming = normalizeCode(readString(incomingCouponCode))
  if (!normalizedIncoming) {
    throw new PromoGuardError("COUPON_INVALID", "Coupon code is required.")
  }

  // Choice: free-shipping is treated as an invalid coupon in v1 when disabled by policy.
  if (!promoPolicy.allowFreeShipping && isFreeShippingCoupon(cart, normalizedIncoming)) {
    throw new PromoGuardError(
      "COUPON_INVALID",
      "Free-shipping coupons are disabled in this environment."
    )
  }

  const existingManualCodes = getExistingManualCouponCodes(cart)

  if (
    !promoPolicy.allowMultipleManualCoupons &&
    existingManualCodes.length > 1
  ) {
    throw new PromoGuardError(
      "COUPON_STACKING_NOT_ALLOWED",
      "Only one manual coupon can be active in v1."
    )
  }

  if (
    existingManualCodes.length === 1 &&
    existingManualCodes[0] !== normalizedIncoming
  ) {
    throw new PromoGuardError(
      "COUPON_STACKING_NOT_ALLOWED",
      "Only one manual coupon can be active in v1."
    )
  }

  if (!promoPolicy.allowAutoPlusManual && hasAutomaticPromotion(cart)) {
    throw new PromoGuardError(
      "COUPON_STACKING_NOT_ALLOWED",
      "Automatic promotions cannot be combined with manual coupons in v1."
    )
  }
}
