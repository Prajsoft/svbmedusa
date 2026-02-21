export const ALLOW_UNSIGNED_WEBHOOKS_ENV = "ALLOW_UNSIGNED_WEBHOOKS"

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value
  }

  const normalized = readText(value).toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false
  }

  return fallback
}

export function shouldAllowUnsignedShippingWebhooks(input: {
  allow_unsigned_webhooks?: unknown
  env?: Record<string, unknown>
} = {}): boolean {
  if (input.allow_unsigned_webhooks !== undefined) {
    return readBool(input.allow_unsigned_webhooks, false)
  }

  const env = input.env ?? process.env
  return readBool(env[ALLOW_UNSIGNED_WEBHOOKS_ENV], false)
}
