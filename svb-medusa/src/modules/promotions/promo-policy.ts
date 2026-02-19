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

export const promoPolicy = {
  allowFreeShipping: readBooleanEnv("PROMO_ALLOW_FREE_SHIPPING", false),
  allowAutoPlusManual: readBooleanEnv("PROMO_ALLOW_AUTO_PLUS_MANUAL", false),
  allowMultipleManualCoupons: false as const,
}
