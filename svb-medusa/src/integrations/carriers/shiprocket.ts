import crypto from "crypto"
import { setTimeout as delay } from "timers/promises"
import { sanitizeProviderPayload } from "../../modules/shipping/sanitize-provider-payload"
import { logProviderCall } from "../../modules/shipping/observability"
import type {
  CancelRequest,
  CancelResponse,
  CreateShipmentRequest,
  CreateShipmentResponse,
  GetLabelRequest,
  HealthCheckResponse,
  LabelResponse,
  ProviderCapabilities,
  ProviderErrorCode,
  QuoteRequest,
  QuoteResponse,
  ShipmentStatus,
  ShippingProvider,
  TrackRequest,
  TrackingResponse,
} from "./provider-contract"
import {
  ShipmentStatus as ShipmentStatusValue,
  ShippingProviderError,
  validateCancelRequest,
  validateCreateShipmentRequest,
  validateGetLabelRequest,
  validateQuoteRequest,
  validateTrackRequest,
} from "./provider-contract"

type FetchResponseLike = {
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

type FetchLike = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  }
) => Promise<FetchResponseLike>

type ShiprocketRuntime = {
  fetch?: FetchLike
  env?: NodeJS.ProcessEnv
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

type ShiprocketRequestInput = {
  method: "GET" | "POST"
  path: string
  body?: Record<string, unknown>
  correlation_id?: string
  operation_name: string
}

type ShiprocketApiErrorInput = {
  status?: number
  body?: unknown
  fallback_message: string
  correlation_id: string
}

type ShiprocketQuoteCompany = {
  courier_company_id?: unknown
  courier_name?: unknown
  freight_charge?: unknown
  rate?: unknown
  cod?: unknown
  etd?: unknown
}

type ShiprocketTrackingEvent = {
  current_status?: unknown
  status?: unknown
  event?: unknown
  date?: unknown
  datetime?: unknown
  location?: unknown
  city?: unknown
  message?: unknown
}

const SHIPROCKET_DEFAULT_BASE_URL = "https://apiv2.shiprocket.in"
const SHIPROCKET_DEFAULT_LABEL_TTL_HOURS = 24
const SHIPROCKET_DEFAULT_TOKEN_TTL_HOURS = 24
const SHIPROCKET_DEFAULT_TOKEN_REFRESH_SKEW_MINUTES = 10
const SHIPROCKET_DEFAULT_RETRY_MAX_ATTEMPTS = 3
const SHIPROCKET_DEFAULT_RETRY_BASE_DELAY_MS = 200
const SHIPROCKET_DEFAULT_RETRY_JITTER_MS = 100
const SHIPROCKET_DEFAULT_RATE_CALCULATOR_PATH = "/v1/external/courier/serviceability/"
const SHIPROCKET_DEFAULT_FORWARD_SHIPMENT_PATH =
  "/v1/external/shipments/create/forward-shipment"
const SHIPROCKET_DEFAULT_LOOKUP_BY_REFERENCE_PATH =
  "/v1/external/orders/show/{reference}"
const SHIPROCKET_DEFAULT_LABEL_TTL_DAYS = 1
const SHIPROCKET_PROVIDER = "shiprocket"
const SHIPROCKET_DEFAULT_SIGNATURE_HEADER = "x-shiprocket-signature"
const RETRYABLE_OPERATION_NAMES = new Set<string>([
  "auth/login",
  "serviceability",
  "rate-calculator",
  "track",
  "getLabel",
  "healthCheck",
])

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const normalizedName = readText(name).toLowerCase()
  if (!normalizedName) {
    return ""
  }

  const entry = Object.entries(headers).find(
    ([key]) => readText(key).toLowerCase() === normalizedName
  )
  if (!entry) {
    return ""
  }

  const value = entry[1]
  if (Array.isArray(value)) {
    return readText(value[0])
  }

  return readText(value)
}

function normalizeIp(input: unknown): string {
  const value = readText(input).toLowerCase()
  if (!value) {
    return ""
  }

  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length)
  }

  return value
}

function parseAllowlist(value: unknown): string[] {
  return readText(value)
    .split(",")
    .map((entry) => normalizeIp(entry))
    .filter(Boolean)
}

function getSourceIp(headers: Record<string, string | string[] | undefined>): string {
  const candidates = [
    readHeader(headers, "x-forwarded-for").split(",")[0],
    readHeader(headers, "x-real-ip"),
    readHeader(headers, "cf-connecting-ip"),
    readHeader(headers, "x-client-ip"),
  ]

  for (const candidate of candidates) {
    const normalized = normalizeIp(candidate)
    if (normalized) {
      return normalized
    }
  }

  return ""
}

function normalizeSignature(value: string): string {
  const normalized = readText(value)
  if (!normalized) {
    return ""
  }

  if (normalized.includes(",")) {
    const first = normalized.split(",")[0]
    return normalizeSignature(first)
  }

  const stripped = normalized.replace(/^sha256=/i, "").trim().toLowerCase()
  return stripped
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const left = readText(a)
  const right = readText(b)
  if (!left || !right || left.length !== right.length) {
    return false
  }

  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function toPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return fallback
}

function normalizeBaseUrl(value: string): string {
  const normalized = readText(value).replace(/\/+$/, "")
  if (!normalized) {
    return SHIPROCKET_DEFAULT_BASE_URL
  }

  const lowered = normalized.toLowerCase()
  if (lowered.endsWith("/v1/external")) {
    return normalized.slice(0, normalized.length - "/v1/external".length)
  }

  return normalized
}

function normalizeApiPath(value: unknown, fallback: string): string {
  const normalized = readText(value) || fallback
  if (!normalized.startsWith("/")) {
    return `/${normalized}`
  }

  return normalized
}

function resolveTokenExpiryMs(input: {
  body: Record<string, unknown>
  now_ms: number
  fallback_ttl_hours: number
}): number {
  const data = getFromRecord<Record<string, unknown>>(input.body, "data")
  const expiryIso =
    toIsoString(getFromRecord(data, "token_expires_at")) ||
    toIsoString(getFromRecord(data, "expires_at")) ||
    toIsoString(getFromRecord(input.body, "token_expires_at")) ||
    toIsoString(getFromRecord(input.body, "expires_at"))
  let expiryMs = 0
  if (expiryIso) {
    expiryMs = new Date(expiryIso).getTime()
  } else {
    const expiresInSeconds =
      toNumber(getFromRecord(data, "expires_in")) ||
      toNumber(getFromRecord(input.body, "expires_in"))
    if (expiresInSeconds > 0) {
      expiryMs = input.now_ms + expiresInSeconds * 1000
    }
  }

  if (expiryMs <= 0) {
    const conservativeHours = Math.max(1, input.fallback_ttl_hours - 1)
    expiryMs = input.now_ms + conservativeHours * 60 * 60 * 1000
  }

  return Math.max(expiryMs, input.now_ms + 60 * 1000)
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

function toIsoString(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  return null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function getFromRecord<T = unknown>(
  record: Record<string, unknown> | null | undefined,
  key: string
): T | undefined {
  if (!record) {
    return undefined
  }

  return record[key] as T | undefined
}

function firstArrayEntry(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }

  const first = value[0]
  return isObject(first) ? first : null
}

function buildTrackingUrl(trackingNumber: string): string {
  const encoded = encodeURIComponent(trackingNumber)
  return `https://shiprocket.co/tracking/${encoded}`
}

function toCorrelationId(input?: string): string {
  const explicit = readText(input)
  if (explicit) {
    return explicit
  }
  return `shiprocket_${Date.now()}`
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const record = error as Record<string, unknown>
  const code = readText(record.code).toUpperCase()
  if (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
      "FETCH_ERROR",
    ].includes(code)
  ) {
    return true
  }

  const message = readText(record.message).toLowerCase()
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("socket")
  )
}

function readErrorMessageFromBody(body: unknown): string {
  if (!isObject(body)) {
    return ""
  }

  const directCandidates = [
    body.message,
    body.error,
    body.detail,
    body.description,
  ]
  for (const candidate of directCandidates) {
    const normalized = readText(candidate)
    if (normalized) {
      return normalized
    }
  }

  const data = getFromRecord<Record<string, unknown>>(body, "data")
  if (isObject(data)) {
    const nestedCandidates = [
      data.message,
      data.error,
      data.detail,
      data.description,
    ]
    for (const candidate of nestedCandidates) {
      const normalized = readText(candidate)
      if (normalized) {
        return normalized
      }
    }
  }

  return ""
}

function normalizeMessage(value: unknown): string {
  return readText(value).toLowerCase()
}

function isAlreadyCancelledMessage(message: unknown): boolean {
  const normalized = normalizeMessage(message)
  if (!normalized) {
    return false
  }

  return (
    normalized.includes("already cancelled") ||
    normalized.includes("already canceled") ||
    normalized.includes("already been cancelled") ||
    normalized.includes("already been canceled")
  )
}

function isCancelSuccessMessage(message: unknown): boolean {
  const normalized = normalizeMessage(message)
  if (!normalized) {
    return false
  }

  return (
    isAlreadyCancelledMessage(normalized) ||
    normalized.includes("cancelled successfully") ||
    normalized.includes("canceled successfully") ||
    normalized.includes("order cancelled") ||
    normalized.includes("order canceled")
  )
}

function isNotCancellableMessage(message: unknown): boolean {
  const normalized = normalizeMessage(message)
  if (!normalized) {
    return false
  }

  return (
    normalized.includes("not cancellable") ||
    normalized.includes("cannot cancel") ||
    normalized.includes("can't cancel") ||
    normalized.includes("cannot be cancelled") ||
    normalized.includes("cannot be canceled") ||
    normalized.includes("already shipped") ||
    normalized.includes("has been shipped")
  )
}

function sanitizeDetailsPayload(body: unknown): Record<string, unknown> {
  return (
    sanitizeProviderPayload(SHIPROCKET_PROVIDER, body) ?? {
      provider: SHIPROCKET_PROVIDER,
    }
  )
}

export function mapShiprocketStatus(rawStatus: unknown): ShipmentStatus {
  const normalized = readText(rawStatus).toLowerCase()
  if (!normalized) {
    return ShipmentStatusValue.BOOKING_IN_PROGRESS
  }

  if (
    normalized.includes("rto") &&
    normalized.includes("delivered")
  ) {
    return ShipmentStatusValue.RTO_DELIVERED
  }

  if (
    normalized.includes("rto") &&
    normalized.includes("transit")
  ) {
    return ShipmentStatusValue.RTO_IN_TRANSIT
  }

  if (normalized.includes("rto")) {
    return ShipmentStatusValue.RTO_INITIATED
  }

  if (
    normalized.includes("cancel") ||
    normalized.includes("void")
  ) {
    return ShipmentStatusValue.CANCELLED
  }

  if (
    normalized.includes("deliver") &&
    !normalized.includes("out for")
  ) {
    return ShipmentStatusValue.DELIVERED
  }

  if (
    normalized === "ofd" ||
    normalized.includes("out for delivery")
  ) {
    return ShipmentStatusValue.OFD
  }

  if (
    normalized.includes("transit") ||
    normalized.includes("shipped") ||
    normalized.includes("manifest")
  ) {
    return ShipmentStatusValue.IN_TRANSIT
  }

  if (
    normalized.includes("pickup") ||
    normalized.includes("ready")
  ) {
    return ShipmentStatusValue.PICKUP_SCHEDULED
  }

  if (
    normalized.includes("booked") ||
    normalized.includes("new") ||
    normalized.includes("create")
  ) {
    return ShipmentStatusValue.BOOKED
  }

  if (
    normalized.includes("fail") ||
    normalized.includes("undeliver") ||
    normalized.includes("exception")
  ) {
    return ShipmentStatusValue.FAILED
  }

  return ShipmentStatusValue.BOOKING_IN_PROGRESS
}

export function mapShiprocketErrorCode(input: {
  status?: number
  message?: string
}): ProviderErrorCode {
  const status = input.status
  const message = readText(input.message).toLowerCase()

  if (isNotCancellableMessage(message)) {
    return "CANNOT_CANCEL_IN_STATE"
  }

  if (status === 401 || status === 403) {
    return "AUTH_FAILED"
  }

  if (status === 429) {
    return "RATE_LIMITED"
  }

  if (status && status >= 500) {
    return "PROVIDER_UNAVAILABLE"
  }

  if (
    message.includes("serviceable") ||
    message.includes("pincode") ||
    message.includes("postcode")
  ) {
    return "SERVICEABILITY_FAILED"
  }

  if (
    message.includes("invalid address") ||
    message.includes("address is invalid") ||
    message.includes("invalid pickup")
  ) {
    return "INVALID_ADDRESS"
  }

  if (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("temporarily unavailable")
  ) {
    return "PROVIDER_UNAVAILABLE"
  }

  return "UPSTREAM_ERROR"
}

function buildForwardShipmentPayload(input: CreateShipmentRequest): Record<string, unknown> {
  const totalWeightGrams = input.parcels.reduce(
    (sum, parcel) => sum + toNumber(parcel.weight_grams),
    0
  )
  const firstParcel = input.parcels[0]
  const totalAmount = input.line_items.reduce((sum, line) => {
    return sum + toNumber(line.unit_price) * toNumber(line.qty)
  }, 0)

  return {
    order_id: input.internal_reference,
    channel_order_id: input.internal_reference,
    order_date: new Date().toISOString().slice(0, 10),
    pickup_location: readText(input.metadata?.pickup_location_code) || "Primary",
    comment: readText(input.notes) || "",
    billing_customer_name: input.delivery_address.name,
    billing_last_name: "",
    billing_address: input.delivery_address.line1,
    billing_address_2: readText(input.delivery_address.line2),
    billing_city: input.delivery_address.city,
    billing_pincode: input.delivery_address.postal_code,
    billing_state: input.delivery_address.state,
    billing_country: input.delivery_address.country_code,
    billing_email: readText(input.delivery_address.email),
    billing_phone: input.delivery_address.phone,
    shipping_customer_name: input.delivery_address.name,
    shipping_address: input.delivery_address.line1,
    shipping_address_2: readText(input.delivery_address.line2),
    shipping_city: input.delivery_address.city,
    shipping_pincode: input.delivery_address.postal_code,
    shipping_state: input.delivery_address.state,
    shipping_country: input.delivery_address.country_code,
    shipping_email: readText(input.delivery_address.email),
    shipping_phone: input.delivery_address.phone,
    shipping_is_billing: true,
    order_items: input.line_items.map((line) => ({
      name: line.name,
      sku: line.sku,
      units: line.qty,
      selling_price: toNumber(line.unit_price),
    })),
    payment_method: input.cod?.enabled ? "COD" : "Prepaid",
    sub_total: totalAmount,
    length: toNumber(firstParcel.dimensions_cm.l),
    breadth: toNumber(firstParcel.dimensions_cm.w),
    height: toNumber(firstParcel.dimensions_cm.h),
    weight: Number((totalWeightGrams / 1000).toFixed(3)),
  }
}

function extractShipmentIdentifiers(body: unknown): {
  provider_order_id?: string
  shipment_id: string
  tracking_number?: string
  label_url?: string
  label_expires_at?: string
  status: ShipmentStatus
} {
  const root = isObject(body) ? body : {}
  const data = getFromRecord<Record<string, unknown>>(root, "data")
  const shipment = isObject(data)
    ? data
    : firstArrayEntry(getFromRecord(root, "shipment_id")) ?? {}
  const shipmentIdCandidates = [
    getFromRecord(root, "shipment_id"),
    getFromRecord(shipment, "shipment_id"),
    getFromRecord(shipment, "id"),
    getFromRecord(root, "id"),
  ]

  let shipmentId = ""
  for (const candidate of shipmentIdCandidates) {
    const normalized = readText(candidate)
    if (normalized) {
      shipmentId = normalized
      break
    }
  }

  const trackingNumber = readText(
    getFromRecord(root, "awb_code") ??
      getFromRecord(shipment, "awb_code") ??
      getFromRecord(shipment, "tracking_number")
  )
  const labelUrl = readText(
    getFromRecord(root, "label_url") ??
      getFromRecord(shipment, "label_url")
  )
  const providerOrderId = readText(
    getFromRecord(root, "order_id") ??
      getFromRecord(shipment, "order_id") ??
      getFromRecord(data, "order_id")
  )
  const labelExpiresAt =
    toIsoString(
      getFromRecord(root, "label_expires_at") ??
        getFromRecord(shipment, "label_expires_at") ??
        getFromRecord(data, "label_expires_at")
    ) ?? undefined
  const status = mapShiprocketStatus(
    getFromRecord(root, "status") ??
      getFromRecord(shipment, "status")
  )

  return {
    provider_order_id: providerOrderId || undefined,
    shipment_id: shipmentId,
    tracking_number: trackingNumber || undefined,
    label_url: labelUrl || undefined,
    label_expires_at: labelExpiresAt,
    status,
  }
}

function extractQuoteCompanies(body: unknown): ShiprocketQuoteCompany[] {
  const root = isObject(body) ? body : {}
  const data = getFromRecord<Record<string, unknown>>(root, "data")

  if (isObject(data)) {
    const available = getFromRecord<unknown[]>(data, "available_courier_companies")
    if (Array.isArray(available)) {
      return available.filter((entry) => isObject(entry))
    }
  }

  const available = getFromRecord<unknown[]>(root, "available_courier_companies")
  if (Array.isArray(available)) {
    return available.filter((entry) => isObject(entry))
  }

  return []
}

function extractRateCompanies(body: unknown): ShiprocketQuoteCompany[] {
  const root = isObject(body) ? body : {}
  const data = getFromRecord<Record<string, unknown>>(root, "data")

  const candidates: unknown[] = []
  if (isObject(data)) {
    candidates.push(
      getFromRecord<unknown[]>(data, "rate_options"),
      getFromRecord<unknown[]>(data, "rates"),
      getFromRecord<unknown[]>(data, "available_courier_companies"),
      getFromRecord<unknown[]>(data, "courier_data")
    )
  }

  candidates.push(
    getFromRecord<unknown[]>(root, "rate_options"),
    getFromRecord<unknown[]>(root, "rates"),
    getFromRecord<unknown[]>(root, "available_courier_companies"),
    getFromRecord<unknown[]>(root, "courier_data")
  )

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate.filter((entry) => isObject(entry))
    }
  }

  return []
}

function extractTrackingPayload(body: unknown): {
  shipment_id?: string
  tracking_number?: string
  status: ShipmentStatus
  events: TrackingResponse["events"]
} {
  const root = isObject(body) ? body : {}
  const trackingData = getFromRecord<Record<string, unknown>>(root, "tracking_data")
  const shipmentTrack = isObject(trackingData)
    ? getFromRecord<unknown[]>(trackingData, "shipment_track")
    : []

  const events: TrackingResponse["events"] = Array.isArray(shipmentTrack)
    ? shipmentTrack
        .filter((entry) => isObject(entry))
        .map((entry) => {
          const event = entry as ShiprocketTrackingEvent
          const rawStatus =
            readText(event.current_status) ||
            readText(event.status) ||
            readText(event.event)
          const occurredAt =
            toIsoString(event.datetime) ||
            toIsoString(event.date) ||
            new Date().toISOString()
          const location =
            readText(event.location) || readText(event.city) || undefined
          const message = readText(event.message) || undefined

          return {
            status: mapShiprocketStatus(rawStatus),
            occurred_at: occurredAt,
            location,
            message,
            raw_status: rawStatus || undefined,
          }
        })
    : []

  const firstEvent = events[0]
  const status = mapShiprocketStatus(
    getFromRecord(trackingData, "shipment_status") ??
      firstEvent?.raw_status ??
      getFromRecord(root, "status")
  )

  const awb =
    readText(getFromRecord(trackingData, "awb_code")) ||
    readText(getFromRecord(root, "awb_code"))
  const shipmentId =
    readText(getFromRecord(trackingData, "shipment_id")) ||
    readText(getFromRecord(root, "shipment_id"))

  return {
    shipment_id: shipmentId || undefined,
    tracking_number: awb || undefined,
    status,
    events,
  }
}

export class ShiprocketProvider implements ShippingProvider {
  readonly provider = SHIPROCKET_PROVIDER

  readonly capabilities: ProviderCapabilities = {
    supports_cod: true,
    supports_reverse: false,
    supports_label_regen: true,
    supports_webhooks: true,
    supports_cancel: true,
    supports_multi_piece: true,
    supports_idempotency: true,
    supports_reference_lookup: true,
  }

  private readonly fetchImpl: FetchLike
  private readonly env: NodeJS.ProcessEnv
  private readonly now: () => Date
  private readonly baseUrl: string
  private readonly labelTtlHours: number
  private readonly labelTtlDays: number
  private readonly tokenTtlHours: number
  private readonly tokenRefreshSkewMinutes: number
  private readonly retryMaxAttempts: number
  private readonly retryBaseDelayMs: number
  private readonly retryJitterMs: number
  private readonly rateCalculatorPath: string
  private readonly forwardShipmentPath: string
  private readonly lookupByReferencePath: string
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number

  private tokenCache: {
    token: string
    expires_at_ms: number
  } | null = null
  private tokenRefreshInFlight: Promise<string> | null = null

  constructor(runtime: ShiprocketRuntime = {}) {
    this.fetchImpl = (runtime.fetch ??
      ((globalThis as unknown as { fetch?: FetchLike }).fetch as FetchLike))
    this.env = runtime.env ?? process.env
    this.now = runtime.now ?? (() => new Date())
    const configuredBaseUrl =
      readText(this.env.SHIPROCKET_BASE_URL) ||
      readText(this.env.SHIPROCKET_API_BASE_URL) ||
      SHIPROCKET_DEFAULT_BASE_URL
    this.baseUrl = normalizeBaseUrl(configuredBaseUrl)
    this.labelTtlHours = toPositiveNumber(
      this.env.SHIPROCKET_LABEL_TTL_HOURS,
      SHIPROCKET_DEFAULT_LABEL_TTL_HOURS
    )
    this.labelTtlDays = toPositiveNumber(
      this.env.SHIPROCKET_LABEL_TTL_DAYS,
      Math.max(
        SHIPROCKET_DEFAULT_LABEL_TTL_DAYS,
        Math.ceil(this.labelTtlHours / 24)
      )
    )
    this.tokenTtlHours = toPositiveNumber(
      this.env.SHIPROCKET_TOKEN_TTL_HOURS,
      SHIPROCKET_DEFAULT_TOKEN_TTL_HOURS
    )
    this.tokenRefreshSkewMinutes = toPositiveNumber(
      this.env.SHIPROCKET_TOKEN_REFRESH_SKEW_MINUTES,
      SHIPROCKET_DEFAULT_TOKEN_REFRESH_SKEW_MINUTES
    )
    this.retryMaxAttempts = Math.floor(
      toPositiveNumber(
        this.env.SHIPROCKET_RETRY_MAX_ATTEMPTS,
        SHIPROCKET_DEFAULT_RETRY_MAX_ATTEMPTS
      )
    )
    this.retryBaseDelayMs = Math.floor(
      toPositiveNumber(
        this.env.SHIPROCKET_RETRY_BASE_DELAY_MS,
        SHIPROCKET_DEFAULT_RETRY_BASE_DELAY_MS
      )
    )
    this.retryJitterMs = Math.floor(
      toPositiveNumber(
        this.env.SHIPROCKET_RETRY_JITTER_MS,
        SHIPROCKET_DEFAULT_RETRY_JITTER_MS
      )
    )
    this.rateCalculatorPath = normalizeApiPath(
      this.env.SHIPROCKET_RATE_CALCULATOR_PATH,
      SHIPROCKET_DEFAULT_RATE_CALCULATOR_PATH
    )
    this.forwardShipmentPath = normalizeApiPath(
      this.env.SHIPROCKET_FORWARD_SHIPMENT_PATH,
      SHIPROCKET_DEFAULT_FORWARD_SHIPMENT_PATH
    )
    this.lookupByReferencePath = normalizeApiPath(
      this.env.SHIPROCKET_LOOKUP_BY_REFERENCE_PATH,
      SHIPROCKET_DEFAULT_LOOKUP_BY_REFERENCE_PATH
    )
    this.sleep = runtime.sleep ?? (async (ms: number) => delay(ms))
    this.random = runtime.random ?? Math.random
  }

  private isTokenCacheFresh(): boolean {
    if (!this.tokenCache) {
      return false
    }

    const skewMs = this.tokenRefreshSkewMinutes * 60 * 1000
    const refreshAt = this.tokenCache.expires_at_ms - skewMs
    return this.now().getTime() < refreshAt
  }

  private computeBackoffMs(attempt: number): number {
    const exponent = Math.max(0, attempt - 1)
    const base = this.retryBaseDelayMs * Math.pow(2, exponent)
    const jitter = Math.floor(this.random() * this.retryJitterMs)
    return base + jitter
  }

  private extractErrorCode(error: unknown): ProviderErrorCode {
    if (error instanceof ShippingProviderError) {
      return error.code
    }

    if (!error || typeof error !== "object") {
      return "UPSTREAM_ERROR"
    }

    const record = error as Record<string, unknown>
    const status = toNumber(record.status) || toNumber(record.statusCode)
    const message = readText(record.message)
    return mapShiprocketErrorCode({
      status: status > 0 ? status : undefined,
      message,
    })
  }

  private logCall(input: {
    method: string
    correlation_id: string
    started_at_ms: number
    success: boolean
    error_code?: string
  }): void {
    const durationMs = Math.max(0, this.now().getTime() - input.started_at_ms)
    logProviderCall({
      provider: this.provider,
      method: input.method,
      duration_ms: durationMs,
      success: input.success,
      error_code: input.error_code ?? null,
      correlation_id: input.correlation_id,
    })
  }

  private toApiError(input: ShiprocketApiErrorInput): ShippingProviderError {
    const messageFromBody = readErrorMessageFromBody(input.body)
    const message = messageFromBody || input.fallback_message
    const code = mapShiprocketErrorCode({
      status: input.status,
      message,
    })

    return new ShippingProviderError({
      code,
      message,
      correlation_id: input.correlation_id,
      details: {
        provider: this.provider,
        status: input.status ?? null,
        sanitized_upstream: sanitizeDetailsPayload(input.body),
      },
    })
  }

  private toQuoteError(
    error: unknown,
    correlationId: string,
    phase: "serviceability" | "rate_calculator"
  ): ShippingProviderError {
    const defaultMessage =
      phase === "serviceability"
        ? "Shiprocket serviceability check failed."
        : "Shiprocket rate calculator failed."

    if (!(error instanceof ShippingProviderError)) {
      return new ShippingProviderError({
        code: "UPSTREAM_ERROR",
        message:
          error instanceof Error && readText(error.message)
            ? error.message
            : defaultMessage,
        correlation_id: correlationId,
        details: {
          provider: this.provider,
          phase,
        },
      })
    }

    const details = (error.details ?? {}) as Record<string, unknown>
    const status = toNumber(details.status)

    if (error.code === "AUTH_FAILED") {
      return error
    }

    if (error.code === "RATE_LIMITED") {
      return error
    }

    if (status === 400 || status === 422) {
      return new ShippingProviderError({
        code: "SERVICEABILITY_FAILED",
        message: error.message || defaultMessage,
        correlation_id: correlationId,
        details: {
          ...details,
          provider: this.provider,
          phase,
        },
      })
    }

    if (
      error.code === "PROVIDER_UNAVAILABLE" ||
      error.code === "UPSTREAM_ERROR" ||
      (status >= 500 && status < 600)
    ) {
      return new ShippingProviderError({
        code: "UPSTREAM_ERROR",
        message: error.message || defaultMessage,
        correlation_id: correlationId,
        details: {
          ...details,
          provider: this.provider,
          phase,
        },
      })
    }

    return error
  }

  private async refreshAuthToken(correlationId: string): Promise<string> {
    const email =
      readText(this.env.SHIPROCKET_SELLER_EMAIL) ||
      readText(this.env.SHIPROCKET_EMAIL)
    const password =
      readText(this.env.SHIPROCKET_SELLER_PASSWORD) ||
      readText(this.env.SHIPROCKET_PASSWORD)
    if (!email || !password) {
      throw new ShippingProviderError({
        code: "AUTH_FAILED",
        message:
          "Shiprocket credentials are missing. Set SHIPROCKET_TOKEN or SHIPROCKET_SELLER_EMAIL/SHIPROCKET_SELLER_PASSWORD.",
        correlation_id: correlationId,
        details: {
          provider: this.provider,
        },
      })
    }

    const body = await this.requestRawJson({
      method: "POST",
      path: "/v1/external/auth/login",
      body: {
        email,
        password,
      },
      correlation_id: correlationId,
      operation_name: "auth/login",
      attachAuth: false,
      retryable: true,
      allow_401_refresh: false,
    })

    const token = readText(
      getFromRecord<Record<string, unknown>>(body, "data")?.token ??
        getFromRecord(body, "token")
    )
    if (!token) {
      throw this.toApiError({
        body,
        fallback_message: "Failed to authenticate with Shiprocket.",
        correlation_id: correlationId,
      })
    }

    const nowMs = this.now().getTime()
    this.tokenCache = {
      token,
      expires_at_ms: resolveTokenExpiryMs({
        body,
        now_ms: nowMs,
        fallback_ttl_hours: this.tokenTtlHours,
      }),
    }

    return token
  }

  private async getAuthToken(
    correlationId: string,
    options: { force_refresh?: boolean } = {}
  ): Promise<string> {
    const staticToken = readText(this.env.SHIPROCKET_TOKEN)
    if (staticToken) {
      return staticToken
    }

    if (!options.force_refresh && this.isTokenCacheFresh()) {
      return this.tokenCache!.token
    }

    if (this.tokenRefreshInFlight) {
      return this.tokenRefreshInFlight
    }

    this.tokenRefreshInFlight = this.refreshAuthToken(correlationId)
    try {
      return await this.tokenRefreshInFlight
    } finally {
      this.tokenRefreshInFlight = null
    }
  }

  private async requestRawJson(
    input: ShiprocketRequestInput & {
      attachAuth?: boolean
      retryable?: boolean
      allow_401_refresh?: boolean
    }
  ): Promise<Record<string, unknown>> {
    if (typeof this.fetchImpl !== "function") {
      throw new ShippingProviderError({
        code: "PROVIDER_UNAVAILABLE",
        message: "Fetch implementation unavailable for Shiprocket provider.",
        correlation_id: toCorrelationId(input.correlation_id),
        details: {
          provider: this.provider,
        },
      })
    }

    const correlationId = toCorrelationId(input.correlation_id)
    const url = `${this.baseUrl}${input.path}`
    const shouldAttachAuth = input.attachAuth !== false
    const shouldRetry =
      input.retryable ?? RETRYABLE_OPERATION_NAMES.has(input.operation_name)
    const maxAttempts = shouldRetry ? Math.max(1, this.retryMaxAttempts) : 1
    const allow401Refresh = input.allow_401_refresh !== false && shouldAttachAuth
    const startedAtMs = this.now().getTime()

    let authRefreshAttempted = false
    let forceAuthRefresh = false
    let attempt = 0
    try {
      for (;;) {
        attempt += 1
        const headers: Record<string, string> = {
          "content-type": "application/json",
        }

        if (shouldAttachAuth) {
          const token = await this.getAuthToken(correlationId, {
            force_refresh: forceAuthRefresh,
          })
          forceAuthRefresh = false
          headers.authorization = `Bearer ${token}`
        }

        let response: FetchResponseLike
        try {
          response = await this.fetchImpl(url, {
            method: input.method,
            headers,
            body: input.body ? JSON.stringify(input.body) : undefined,
          })
        } catch (error) {
          if (shouldRetry && attempt < maxAttempts && isNetworkError(error)) {
            await this.sleep(this.computeBackoffMs(attempt))
            continue
          }

          throw new ShippingProviderError({
            code: "PROVIDER_UNAVAILABLE",
            message:
              error instanceof Error
                ? error.message
                : "Shiprocket network request failed.",
            correlation_id: correlationId,
            details: {
              provider: this.provider,
            },
          })
        }

        let parsedBody: unknown = null
        try {
          parsedBody = await response.json()
        } catch {
          const text = await response.text().catch(() => "")
          parsedBody = text ? { message: text } : {}
        }

        if (response.status < 300) {
          this.logCall({
            method:
              input.operation_name === "auth/login"
                ? "auth/login"
                : `request/${input.operation_name}`,
            correlation_id: correlationId,
            started_at_ms: startedAtMs,
            success: true,
          })
          return isObject(parsedBody) ? parsedBody : {}
        }

        if (response.status === 401 && allow401Refresh && !authRefreshAttempted) {
          authRefreshAttempted = true
          forceAuthRefresh = true
          continue
        }

        if (shouldRetry && attempt < maxAttempts && isRetryableStatus(response.status)) {
          await this.sleep(this.computeBackoffMs(attempt))
          continue
        }

        throw this.toApiError({
          status: response.status,
          body: parsedBody,
          fallback_message: `Shiprocket request failed with status ${response.status}.`,
          correlation_id: correlationId,
        })
      }
    } catch (error) {
      this.logCall({
        method:
          input.operation_name === "auth/login"
            ? "auth/login"
            : `request/${input.operation_name}`,
        correlation_id: correlationId,
        started_at_ms: startedAtMs,
        success: false,
        error_code: this.extractErrorCode(error),
      })
      throw error
    }
  }

  private async serviceabilityCheck(input: {
    request: QuoteRequest
  }): Promise<ShiprocketQuoteCompany[]> {
    const valid = input.request
    const totalWeightGrams = valid.parcels.reduce(
      (sum, parcel) => sum + toNumber(parcel.weight_grams),
      0
    )

    const query = new URLSearchParams({
      pickup_postcode: valid.pickup_address.postal_code,
      delivery_postcode: valid.delivery_address.postal_code,
      cod: valid.cod?.enabled ? "1" : "0",
      weight: Number((totalWeightGrams / 1000).toFixed(3)).toString(),
    })

    let body: Record<string, unknown>
    try {
      body = await this.requestRawJson({
        method: "GET",
        path: `/v1/external/courier/serviceability/?${query.toString()}`,
        correlation_id: valid.correlation_id,
        operation_name: "serviceability",
      })
    } catch (error) {
      throw this.toQuoteError(
        error,
        toCorrelationId(valid.correlation_id),
        "serviceability"
      )
    }

    const companies = extractQuoteCompanies(body)
    if (companies.length === 0) {
      throw new ShippingProviderError({
        code: "SERVICEABILITY_FAILED",
        message: "No serviceable courier options returned by Shiprocket.",
        correlation_id: toCorrelationId(valid.correlation_id),
        details: {
          provider: this.provider,
          phase: "serviceability",
          pickup_postcode: valid.pickup_address.postal_code,
          delivery_postcode: valid.delivery_address.postal_code,
        },
      })
    }

    return companies
  }

  private async rateCalculator(input: {
    request: QuoteRequest
    serviceable_companies: ShiprocketQuoteCompany[]
  }): Promise<ShiprocketQuoteCompany[]> {
    const valid = input.request
    const totalWeightGrams = valid.parcels.reduce(
      (sum, parcel) => sum + toNumber(parcel.weight_grams),
      0
    )
    const firstParcel = valid.parcels[0]
    const courierCompanyIds = input.serviceable_companies
      .map((company) => {
        if (typeof company.courier_company_id === "number") {
          return String(company.courier_company_id)
        }

        return readText(company.courier_company_id)
      })
      .filter(Boolean)
    const declaredValue = (valid.line_items ?? []).reduce((sum, lineItem) => {
      return sum + toNumber(lineItem.unit_price) * toNumber(lineItem.qty)
    }, 0)

    let body: Record<string, unknown>
    try {
      body = await this.requestRawJson({
        method: "POST",
        path: this.rateCalculatorPath,
        body: {
          pickup_postcode: valid.pickup_address.postal_code,
          delivery_postcode: valid.delivery_address.postal_code,
          cod: valid.cod?.enabled ? 1 : 0,
          weight: Number((totalWeightGrams / 1000).toFixed(3)),
          length: toNumber(firstParcel?.dimensions_cm?.l),
          breadth: toNumber(firstParcel?.dimensions_cm?.w),
          height: toNumber(firstParcel?.dimensions_cm?.h),
          declared_value: declaredValue > 0 ? declaredValue : undefined,
          courier_company_ids: courierCompanyIds,
        },
        correlation_id: valid.correlation_id,
        operation_name: "rate-calculator",
      })
    } catch (error) {
      throw this.toQuoteError(
        error,
        toCorrelationId(valid.correlation_id),
        "rate_calculator"
      )
    }

    const companies = extractRateCompanies(body)
    if (companies.length === 0) {
      throw new ShippingProviderError({
        code: "UPSTREAM_ERROR",
        message: "Shiprocket rate calculator returned no rate options.",
        correlation_id: toCorrelationId(valid.correlation_id),
        details: {
          provider: this.provider,
          phase: "rate_calculator",
        },
      })
    }

    return companies
  }

  async quote(input: QuoteRequest): Promise<QuoteResponse> {
    const valid = validateQuoteRequest(input)
    const serviceableCompanies = await this.serviceabilityCheck({
      request: valid,
    })
    const rateCompanies = await this.rateCalculator({
      request: valid,
      serviceable_companies: serviceableCompanies,
    })

    const serviceableById = new Map<string, ShiprocketQuoteCompany>()
    for (const company of serviceableCompanies) {
      const courierCompanyId =
        typeof company.courier_company_id === "number"
          ? String(company.courier_company_id)
          : readText(company.courier_company_id)
      if (courierCompanyId) {
        serviceableById.set(courierCompanyId, company)
      }
    }

    return {
      quotes: rateCompanies.map((company) => {
        const courierCompanyId =
          typeof company.courier_company_id === "number"
            ? String(company.courier_company_id)
            : readText(company.courier_company_id)
        const serviceableMatch = courierCompanyId
          ? serviceableById.get(courierCompanyId)
          : undefined
        const serviceCode =
          courierCompanyId ||
          readText(company.courier_name) ||
          readText(serviceableMatch?.courier_name) ||
          "shiprocket"
        const serviceName =
          readText(company.courier_name) ||
          readText(serviceableMatch?.courier_name) ||
          "Shiprocket"

        return {
          service_code: serviceCode,
          service_name: serviceName,
          price: Math.max(
            0,
            toNumber(company.freight_charge) ||
              toNumber(company.rate) ||
              toNumber(serviceableMatch?.freight_charge) ||
              toNumber(serviceableMatch?.rate)
          ),
          currency_code: valid.currency_code,
          eta_days:
            toPositiveNumber(company.etd, 0) ||
            toPositiveNumber(serviceableMatch?.etd, 0) ||
            undefined,
          cod_supported: Boolean(company.cod) || Boolean(serviceableMatch?.cod),
          metadata: {
            provider: this.provider,
            courier_company_id: courierCompanyId || undefined,
          },
        }
      }),
    }
  }

  async createShipment(
    input: CreateShipmentRequest
  ): Promise<CreateShipmentResponse> {
    const bookingEnabled = readText(this.env.SHIPPING_BOOKING_ENABLED).toLowerCase()
    if (bookingEnabled && ["false", "0", "no", "off"].includes(bookingEnabled)) {
      throw new ShippingProviderError({
        code: "BOOKING_DISABLED",
        message: "Shipping booking is disabled by SHIPPING_BOOKING_ENABLED=false.",
        correlation_id: toCorrelationId(input.correlation_id),
        details: {
          provider: this.provider,
        },
      })
    }

    const valid = validateCreateShipmentRequest(input)
    const body = await this.requestRawJson({
      method: "POST",
      path: this.forwardShipmentPath,
      body: buildForwardShipmentPayload(valid),
      correlation_id: valid.correlation_id,
      operation_name: "createShipment",
      retryable: false,
    })

    const extracted = extractShipmentIdentifiers(body)
    if (!extracted.shipment_id) {
      throw this.toApiError({
        body,
        fallback_message: "Shiprocket did not return shipment_id.",
        correlation_id: toCorrelationId(valid.correlation_id),
      })
    }
    const bookedAtIso = this.now().toISOString()
    const fallbackLabelExpiry = new Date(
      new Date(bookedAtIso).getTime() +
        this.labelTtlDays * 24 * 60 * 60 * 1000
    ).toISOString()
    const resolvedLabelExpiry = extracted.label_expires_at ?? fallbackLabelExpiry

    return {
      shipment_id: extracted.shipment_id,
      tracking_number: extracted.tracking_number,
      tracking_url: extracted.tracking_number
        ? buildTrackingUrl(extracted.tracking_number)
        : undefined,
      status: extracted.status,
      label: extracted.label_url
        ? {
            shipment_id: extracted.shipment_id,
            label_url: extracted.label_url,
            mime_type: "application/pdf",
            label_expires_at: resolvedLabelExpiry,
            regenerated: false,
          }
        : undefined,
      booked_at: bookedAtIso,
      metadata: {
        provider: this.provider,
        internal_reference: valid.internal_reference,
        provider_order_id:
          extracted.provider_order_id || valid.internal_reference,
      },
    }
  }

  async findShipmentByReference(input: {
    internal_reference: string
    correlation_id?: string
  }): Promise<CreateShipmentResponse | null> {
    const internalReference = readText(input.internal_reference)
    if (!internalReference) {
      return null
    }

    const correlationId = toCorrelationId(input.correlation_id)
    const encodedReference = encodeURIComponent(internalReference)
    const pathTemplate = this.lookupByReferencePath
    const path = pathTemplate.includes("{reference}")
      ? pathTemplate.replaceAll("{reference}", encodedReference)
      : `${pathTemplate}${pathTemplate.includes("?") ? "&" : "?"}order_id=${encodedReference}`

    let body: Record<string, unknown>
    try {
      body = await this.requestRawJson({
        method: "GET",
        path,
        correlation_id: correlationId,
        operation_name: "lookup-by-reference",
      })
    } catch (error) {
      if (error instanceof ShippingProviderError) {
        const details = (error.details ?? {}) as Record<string, unknown>
        const status = toNumber(details.status)
        if (status === 404) {
          return null
        }
      }
      throw error
    }

    const extracted = extractShipmentIdentifiers(body)
    if (!extracted.shipment_id) {
      return null
    }

    const providerOrderId = extracted.provider_order_id || internalReference
    const labelExpiresAt =
      extracted.label_expires_at ??
      new Date(
        this.now().getTime() + this.labelTtlDays * 24 * 60 * 60 * 1000
      ).toISOString()

    return {
      shipment_id: extracted.shipment_id,
      tracking_number: extracted.tracking_number,
      tracking_url: extracted.tracking_number
        ? buildTrackingUrl(extracted.tracking_number)
        : undefined,
      status: extracted.status ?? ShipmentStatusValue.BOOKED,
      label: extracted.label_url
        ? {
            shipment_id: extracted.shipment_id,
            label_url: extracted.label_url,
            mime_type: "application/pdf",
            label_expires_at: labelExpiresAt,
            regenerated: false,
          }
        : undefined,
      booked_at: this.now().toISOString(),
      metadata: {
        provider: this.provider,
        internal_reference: internalReference,
        provider_order_id: providerOrderId,
      },
    }
  }

  private async generateLabel(
    shipmentId: string,
    correlationId?: string
  ): Promise<Record<string, unknown>> {
    return this.requestRawJson({
      method: "POST",
      path: "/v1/external/courier/generate/label",
      body: {
        shipment_id: [shipmentId],
      },
      correlation_id: correlationId,
      operation_name: "getLabel",
    })
  }

  async getLabel(input: GetLabelRequest): Promise<LabelResponse> {
    const valid = validateGetLabelRequest(input)
    const first = await this.generateLabel(
      valid.shipment_id,
      valid.correlation_id
    )

    const firstData = getFromRecord<Record<string, unknown>>(first, "data")
    let labelUrl =
      readText(getFromRecord(firstData, "label_url")) ||
      readText(getFromRecord(first, "label_url"))
    let regenerated = false
    let labelSource = first

    if (!labelUrl && valid.regenerate_if_expired) {
      const second = await this.generateLabel(
        valid.shipment_id,
        valid.correlation_id
      )
      const secondData = getFromRecord<Record<string, unknown>>(second, "data")
      labelUrl =
        readText(getFromRecord(secondData, "label_url")) ||
        readText(getFromRecord(second, "label_url"))
      if (labelUrl) {
        regenerated = true
        labelSource = second
      }
    }

    if (!labelUrl) {
      throw this.toApiError({
        body: labelSource,
        fallback_message: "Shiprocket label URL is missing.",
        correlation_id: toCorrelationId(valid.correlation_id),
      })
    }

    const sourceData = getFromRecord<Record<string, unknown>>(labelSource, "data")
    const createdAt =
      toIsoString(getFromRecord(sourceData, "label_created_at")) ||
      this.now().toISOString()
    const expiresAt = new Date(
      new Date(createdAt).getTime() + this.labelTtlHours * 60 * 60 * 1000
    ).toISOString()

    return {
      shipment_id: valid.shipment_id,
      label_url: labelUrl,
      mime_type: "application/pdf",
      label_expires_at: expiresAt,
      regenerated,
    }
  }

  async track(input: TrackRequest): Promise<TrackingResponse> {
    const valid = validateTrackRequest(input)
    const trackingNumber = readText(valid.tracking_number)
    const shipmentId = readText(valid.shipment_id)
    const internalReference = readText(valid.internal_reference)

    let resolvedTrackingNumber = trackingNumber
    let resolvedShipmentId = shipmentId
    if (!resolvedTrackingNumber && !resolvedShipmentId && internalReference) {
      const lookedUp = await this.findShipmentByReference({
        internal_reference: internalReference,
        correlation_id: valid.correlation_id,
      })

      if (!lookedUp) {
        throw new ShippingProviderError({
          code: "SERVICEABILITY_FAILED",
          message:
            "Unable to find Shiprocket shipment for internal reference.",
          correlation_id: toCorrelationId(valid.correlation_id),
          details: {
            provider: this.provider,
            internal_reference: internalReference,
          },
        })
      }

      resolvedTrackingNumber = readText(lookedUp.tracking_number)
      resolvedShipmentId = readText(lookedUp.shipment_id)
    }

    if (!resolvedTrackingNumber && !resolvedShipmentId) {
      throw new ShippingProviderError({
        code: "SERVICEABILITY_FAILED",
        message:
          "Shiprocket tracking requires tracking_number, shipment_id, or resolvable internal_reference.",
        correlation_id: toCorrelationId(valid.correlation_id),
        details: {
          provider: this.provider,
        },
      })
    }

    const path = resolvedTrackingNumber
      ? `/v1/external/courier/track/awb/${encodeURIComponent(
          resolvedTrackingNumber
        )}`
      : `/v1/external/courier/track/shipment/${encodeURIComponent(
          resolvedShipmentId
        )}`

    const body = await this.requestRawJson({
      method: "GET",
      path,
      correlation_id: valid.correlation_id,
      operation_name: "track",
    })

    const extracted = extractTrackingPayload(body)
    return {
      shipment_id:
        extracted.shipment_id ||
        resolvedShipmentId ||
        resolvedTrackingNumber ||
        internalReference,
      tracking_number:
        extracted.tracking_number || resolvedTrackingNumber || undefined,
      status: extracted.status,
      events: extracted.events.map((event) => ({
        ...event,
        raw_status: event.raw_status || undefined,
      })),
    }
  }

  async cancel(input: CancelRequest): Promise<CancelResponse> {
    const valid = validateCancelRequest(input)
    const correlationId = toCorrelationId(valid.correlation_id)
    let body: Record<string, unknown> | null = null

    try {
      body = await this.requestRawJson({
        method: "POST",
        path: "/v1/external/orders/cancel",
        body: {
          ids: [valid.shipment_id],
        },
        correlation_id: valid.correlation_id,
        operation_name: "cancel",
        retryable: false,
      })
    } catch (error) {
      if (error instanceof ShippingProviderError) {
        if (isAlreadyCancelledMessage(error.message)) {
          return {
            shipment_id: valid.shipment_id,
            cancelled: true,
            status: ShipmentStatusValue.CANCELLED,
            cancelled_at: this.now().toISOString(),
          }
        }

        if (
          error.code === "CANNOT_CANCEL_IN_STATE" ||
          isNotCancellableMessage(error.message)
        ) {
          throw new ShippingProviderError({
            code: "CANNOT_CANCEL_IN_STATE",
            message: "Shipment cannot be cancelled in current carrier state.",
            correlation_id: error.correlation_id || correlationId,
            details: {
              ...(error.details ?? {}),
              provider: this.provider,
            },
          })
        }
      }

      throw error
    }

    const message = readErrorMessageFromBody(body)
    const cancelled =
      isCancelSuccessMessage(message) ||
      Boolean(getFromRecord(body, "cancelled")) ||
      Boolean(getFromRecord(getFromRecord(body, "data"), "cancelled"))

    if (!cancelled && isNotCancellableMessage(message)) {
      throw new ShippingProviderError({
        code: "CANNOT_CANCEL_IN_STATE",
        message: "Shipment cannot be cancelled in current carrier state.",
        correlation_id: correlationId,
        details: {
          provider: this.provider,
          sanitized_upstream: sanitizeDetailsPayload(body),
        },
      })
    }

    return {
      shipment_id: valid.shipment_id,
      cancelled,
      status: cancelled
        ? ShipmentStatusValue.CANCELLED
        : ShipmentStatusValue.BOOKED,
      cancelled_at: cancelled ? this.now().toISOString() : undefined,
    }
  }

  async healthCheck(): Promise<HealthCheckResponse> {
    const correlationId = toCorrelationId()
    try {
      await this.requestRawJson({
        method: "GET",
        path: "/v1/external/courier/serviceability/?pickup_postcode=110001&delivery_postcode=110001&cod=0&weight=0.5",
        correlation_id: correlationId,
        operation_name: "healthCheck",
      })

      return {
        ok: true,
        provider: this.provider,
        checked_at: this.now().toISOString(),
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Shiprocket health check failed."
      return {
        ok: false,
        provider: this.provider,
        checked_at: this.now().toISOString(),
        details: {
          code:
            error instanceof ShippingProviderError
              ? error.code
              : "PROVIDER_UNAVAILABLE",
          message,
        },
      }
    }
  }

  verifyWebhook(request: {
    headers: Record<string, string | string[] | undefined>
    raw_body: string
    body?: unknown
  }): boolean {
    const secret = readText(this.env.SHIPROCKET_WEBHOOK_SECRET)
    if (!secret) {
      return false
    }

    const allowlist = parseAllowlist(this.env.SHIPROCKET_WEBHOOK_IP_ALLOWLIST)
    if (allowlist.length > 0) {
      const sourceIp = getSourceIp(request.headers ?? {})
      if (!sourceIp || !allowlist.includes(sourceIp)) {
        return false
      }
    }

    const configuredHeader =
      readText(this.env.SHIPROCKET_WEBHOOK_SIGNATURE_HEADER) ||
      SHIPROCKET_DEFAULT_SIGNATURE_HEADER
    const signatureFromHeader =
      readHeader(request.headers ?? {}, configuredHeader) ||
      readHeader(request.headers ?? {}, SHIPROCKET_DEFAULT_SIGNATURE_HEADER) ||
      readHeader(request.headers ?? {}, "x-webhook-signature") ||
      readHeader(request.headers ?? {}, "x-signature")
    const providedSignature = normalizeSignature(signatureFromHeader)
    if (!providedSignature) {
      return false
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(request.raw_body ?? "")
      .digest("hex")

    return timingSafeHexEqual(providedSignature, expectedSignature)
  }
}
