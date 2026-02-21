function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readBool(value: unknown): boolean {
  const normalized = readText(value).toLowerCase()
  return ["true", "1", "yes", "on"].includes(normalized)
}

function isShiprocketSelected(env: NodeJS.ProcessEnv): {
  selected: boolean
  selectors: string[]
} {
  const selectors: string[] = []
  const defaultProvider = readText(env.SHIPPING_PROVIDER_DEFAULT).toLowerCase()
  const carrierAdapter = readText(env.CARRIER_ADAPTER).toLowerCase()

  if (defaultProvider === "shiprocket") {
    selectors.push("SHIPPING_PROVIDER_DEFAULT=shiprocket")
  }

  if (carrierAdapter === "shiprocket") {
    selectors.push("CARRIER_ADAPTER=shiprocket")
  }

  return {
    selected: selectors.length > 0,
    selectors,
  }
}

function hasShiprocketCredentials(env: NodeJS.ProcessEnv): boolean {
  const token = readText(env.SHIPROCKET_TOKEN)
  if (token) {
    return true
  }

  const sellerEmail =
    readText(env.SHIPROCKET_SELLER_EMAIL) || readText(env.SHIPROCKET_EMAIL)
  const sellerPassword =
    readText(env.SHIPROCKET_SELLER_PASSWORD) || readText(env.SHIPROCKET_PASSWORD)

  return Boolean(sellerEmail && sellerPassword)
}

function hasShiprocketWebhookToken(env: NodeJS.ProcessEnv): boolean {
  return Boolean(readText(env.SHIPROCKET_WEBHOOK_TOKEN))
}

export class ShippingProviderConfigError extends Error {
  code: string
  reason: string

  constructor(code: string, reason: string) {
    super(code)
    this.name = "ShippingProviderConfigError"
    this.code = code
    this.reason = reason
  }
}

export function validateShippingProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): void {
  const selection = isShiprocketSelected(env)
  if (!selection.selected) {
    return
  }

  if (!hasShiprocketCredentials(env)) {
    throw new ShippingProviderConfigError(
      "PROVIDER_CONFIG_MISSING",
      `${selection.selectors.join(
        " + "
      )} requires SHIPROCKET_TOKEN or SHIPROCKET_SELLER_EMAIL/SHIPROCKET_SELLER_PASSWORD.`
    )
  }

  const allowUnsigned = readBool(env.ALLOW_UNSIGNED_WEBHOOKS)
  if (!allowUnsigned && !hasShiprocketWebhookToken(env)) {
    throw new ShippingProviderConfigError(
      "PROVIDER_CONFIG_MISSING",
      `${selection.selectors.join(
        " + "
      )} requires SHIPROCKET_WEBHOOK_TOKEN when ALLOW_UNSIGNED_WEBHOOKS=false.`
    )
  }
}

export function shouldLogWebhookSecurityDegradedOnBoot(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return readBool(env.ALLOW_UNSIGNED_WEBHOOKS)
}
