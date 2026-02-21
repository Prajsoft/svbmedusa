const STRIP_KEYS = new Set([
  "name",
  "full_name",
  "first_name",
  "last_name",
  "phone",
  "mobile",
  "email",
  "address",
  "address1",
  "address2",
  "address_1",
  "address_2",
  "line1",
  "line2",
  "landmark",
  "customer_notes",
  "customer_note",
  "notes",
  "note",
])

const STRIP_OBJECT_KEYS = new Set([
  "recipient",
  "recipient_details",
  "customer",
  "customer_details",
  "consignee",
])

const ALLOW_KEYS = new Set([
  "provider",
  "provider_event_id",
  "provider_shipment_id",
  "provider_order_id",
  "shipment_id",
  "order_id",
  "sr_order_id",
  "shiprocket_order_id",
  "internal_reference",
  "awb",
  "awb_code",
  "awb_number",
  "tracking_number",
  "tracking_id",
  "service",
  "service_level",
  "service_code",
  "courier",
  "courier_code",
  "courier_name",
  "status",
  "current_status",
  "shipment_status",
  "status_code",
  "current_status_id",
  "shipment_status_id",
  "raw_status",
  "event",
  "event_type",
  "webhook_security",
  "security_mode",
  "security_reason",
  "error",
  "error_code",
  "error_type",
  "error_message",
  "timestamp",
  "current_timestamp",
  "created_at",
  "updated_at",
  "occurred_at",
  "picked_up_at",
  "delivered_at",
  "expected_delivery_at",
  "eta",
  "city",
  "state",
  "country",
  "country_code",
  "pincode",
  "postal_code",
  "zip",
  "weight",
  "weight_grams",
  "weight_kg",
  "dimensions",
  "dimensions_cm",
  "length",
  "width",
  "height",
  "l",
  "w",
  "h",
])

function normalizeKey(input: string): string {
  return input.trim().toLowerCase()
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
}

function sanitizeObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalizeKey(key)

    if (STRIP_OBJECT_KEYS.has(normalizedKey)) {
      continue
    }

    if (STRIP_KEYS.has(normalizedKey)) {
      continue
    }

    if (value === undefined) {
      continue
    }

    if (Array.isArray(value)) {
      const sanitizedArray = value
        .map((entry) => sanitizeValue(normalizedKey, entry))
        .filter((entry) => entry !== undefined)

      if (sanitizedArray.length > 0 && (ALLOW_KEYS.has(normalizedKey) || normalizedKey.endsWith("_history"))) {
        output[key] = sanitizedArray
      }
      continue
    }

    if (value && typeof value === "object") {
      const nested = sanitizeObject(value as Record<string, unknown>)
      if (Object.keys(nested).length > 0 && ALLOW_KEYS.has(normalizedKey)) {
        output[key] = nested
      }
      continue
    }

    if (isPrimitive(value) && ALLOW_KEYS.has(normalizedKey)) {
      output[key] = value
    }
  }

  return output
}

function sanitizeValue(parentKey: string, value: unknown): unknown {
  if (value === undefined) {
    return undefined
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => sanitizeValue(parentKey, entry))
      .filter((entry) => entry !== undefined)
    return sanitized.length ? sanitized : undefined
  }

  if (value && typeof value === "object") {
    const nested = sanitizeObject(value as Record<string, unknown>)
    return Object.keys(nested).length ? nested : undefined
  }

  if (isPrimitive(value) && ALLOW_KEYS.has(parentKey)) {
    return value
  }

  return undefined
}

/**
 * Enforces a DPDP-safe sanitization policy for provider payloads.
 * We only keep non-PII operational fields required for shipping diagnostics.
 */
export function sanitizeProviderPayload(
  provider: string,
  raw: unknown
): Record<string, unknown> | null {
  const providerName = typeof provider === "string" ? provider.trim().toLowerCase() : ""
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}

  const sanitized = sanitizeObject(source)

  if (providerName) {
    sanitized.provider = providerName
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null
}
