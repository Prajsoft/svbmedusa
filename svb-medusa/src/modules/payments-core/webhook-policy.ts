export const ALLOW_UNVERIFIED_WEBHOOKS_ENV = "PAYMENTS_ALLOW_UNVERIFIED_WEBHOOKS"
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

export function shouldAllowUnverifiedWebhook(input: {
  allow_unverified_webhooks?: unknown
  env?: Record<string, unknown>
} = {}): boolean {
  if (input.allow_unverified_webhooks !== undefined) {
    return readBool(input.allow_unverified_webhooks, false)
  }

  const env = input.env ?? process.env
  if (env[ALLOW_UNSIGNED_WEBHOOKS_ENV] !== undefined) {
    return readBool(env[ALLOW_UNSIGNED_WEBHOOKS_ENV], false)
  }

  return readBool(env[ALLOW_UNVERIFIED_WEBHOOKS_ENV], false)
}
