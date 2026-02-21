import crypto from "crypto"
import { setTimeout as delay } from "timers/promises"
import { logProviderCall } from "../../modules/shipping/observability"
import type {
  CreateShippingShipmentInput,
  ShippingPersistenceRepository,
} from "../../modules/shipping/shipment-persistence"
import type {
  CancelRequest,
  CancelResponse,
  CreateShipmentRequest,
  CreateShipmentResponse,
  GetLabelRequest,
  HealthCheckResponse,
  LabelResponse,
  LookupShipmentByReferenceRequest,
  ProviderErrorCode,
  QuoteRequest,
  QuoteResponse,
  ShipmentStatus,
  ShippingProvider,
  ShippingProviderErrorObject,
  TrackRequest,
  TrackingResponse,
} from "./provider-contract"
import { ShippingProviderError } from "./provider-contract"

const RETRYABLE_METHODS = new Set<ShippingRouterMethod>([
  "quote",
  "lookupShipmentByReference",
  "track",
  "getLabel",
  "healthCheck",
])

type ShippingRouterMethod =
  | "quote"
  | "createShipment"
  | "lookupShipmentByReference"
  | "getLabel"
  | "track"
  | "cancel"
  | "healthCheck"

type RetryConfig = {
  max_attempts: number
  base_delay_ms: number
  jitter_ms: number
}

type CircuitBreakerConfig = {
  consecutive_failures_threshold: number
  error_rate_threshold_percent: number
  rolling_window_size: number
  open_duration_ms: number
}

type CircuitState = {
  open_until_ms: number | null
  consecutive_failures: number
  outcomes: boolean[]
}

type ShipmentRepositoryLike = Pick<ShippingPersistenceRepository, "getShipmentById"> | {
  getShipmentById: (
    shipmentId: string
  ) => Promise<
    Pick<
      CreateShippingShipmentInput,
      | "provider"
      | "provider_shipment_id"
      | "provider_awb"
      | "internal_reference"
      | "status"
    > & { id?: string } | null
  >
  updateShipmentStatusMonotonic?: (input: {
    shipment_id: string
    next_status: ShipmentStatus
  }) => Promise<{
    updated: boolean
    shipment: (Pick<CreateShippingShipmentInput, "status"> & { id?: string }) | null
  }>
}

type RouterOptions = {
  providers: Record<string, ShippingProvider>
  env?: NodeJS.ProcessEnv
  scopeOrLogger?: unknown
  shipment_repository?: ShipmentRepositoryLike
  retry?: Partial<RetryConfig>
  circuit_breaker?: Partial<CircuitBreakerConfig>
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  now?: () => number
}

type RoutedRequestInput<TRequest> = {
  provider?: string
  request: TRequest
  correlation_id?: string
}

type TrackByShipmentInput = {
  shipment_id: string
  tracking_number?: string
  correlation_id?: string
}

type CancelByShipmentInput = {
  shipment_id: string
  reason?: string
  correlation_id?: string
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value
  }

  const normalized = readText(value).toLowerCase()
  if (!normalized) {
    return fallback
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false
  }

  return fallback
}

function readPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? value : fallback
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed > 0 ? parsed : fallback
    }
  }

  return fallback
}

function resolveCorrelationId(value?: string): string {
  return readText(value) || crypto.randomUUID()
}

function resolveErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined
  }

  const record = error as Record<string, unknown>
  const candidates = [
    record.status,
    record.statusCode,
    record.http_status,
    (record.details as Record<string, unknown> | undefined)?.http_status,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.floor(candidate)
    }
    if (typeof candidate === "string") {
      const parsed = Number(candidate)
      if (Number.isFinite(parsed)) {
        return Math.floor(parsed)
      }
    }
  }

  return undefined
}

function resolveErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") {
    return ""
  }

  const record = error as Record<string, unknown>
  return readText(record.code)
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
    ].includes(code)
  ) {
    return true
  }

  const message = readText(record.message).toLowerCase()
  return (
    message.includes("network") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up")
  )
}

function mapUnknownErrorCode(error: unknown): ProviderErrorCode {
  const status = resolveErrorStatus(error)
  if (status === 401 || status === 403) {
    return "AUTH_FAILED"
  }
  if (status === 429) {
    return "RATE_LIMITED"
  }
  if (status === 404) {
    return "SHIPMENT_NOT_FOUND"
  }
  if (typeof status === "number" && status >= 500) {
    return "UPSTREAM_ERROR"
  }
  if (isNetworkError(error)) {
    return "PROVIDER_UNAVAILABLE"
  }

  const normalizedCode = resolveErrorCode(error)
  if (
    normalizedCode === "AUTH_FAILED" ||
    normalizedCode === "SERVICEABILITY_FAILED" ||
    normalizedCode === "RATE_LIMITED" ||
    normalizedCode === "UPSTREAM_ERROR" ||
    normalizedCode === "INVALID_ADDRESS" ||
    normalizedCode === "SHIPMENT_NOT_FOUND" ||
    normalizedCode === "BOOKING_DISABLED" ||
    normalizedCode === "CANNOT_CANCEL_IN_STATE" ||
    normalizedCode === "NOT_SUPPORTED" ||
    normalizedCode === "SIGNATURE_INVALID" ||
    normalizedCode === "PROVIDER_UNAVAILABLE"
  ) {
    return normalizedCode
  }

  return "UPSTREAM_ERROR"
}

function isRetryableError(error: unknown): boolean {
  const status = resolveErrorStatus(error)
  if (status === 429 || (typeof status === "number" && status >= 500)) {
    return true
  }

  if (isNetworkError(error)) {
    return true
  }

  const code = resolveErrorCode(error)
  if (
    code === "RATE_LIMITED" ||
    code === "UPSTREAM_ERROR" ||
    code === "PROVIDER_UNAVAILABLE"
  ) {
    return true
  }

  return false
}

function normalizeProviderMap(
  providers: Record<string, ShippingProvider>
): Record<string, ShippingProvider> {
  const normalized: Record<string, ShippingProvider> = {}
  for (const [key, provider] of Object.entries(providers ?? {})) {
    const normalizedKey = readText(key).toLowerCase()
    if (normalizedKey) {
      normalized[normalizedKey] = provider
    }

    const providerId = readText(provider?.provider).toLowerCase()
    if (providerId) {
      normalized[providerId] = provider
    }
  }

  return normalized
}

function toShippingProviderError(input: {
  error: unknown
  correlation_id: string
  provider: string
  method: ShippingRouterMethod
}): ShippingProviderError {
  if (input.error instanceof ShippingProviderError) {
    return input.error
  }

  return new ShippingProviderError({
    code: mapUnknownErrorCode(input.error),
    message:
      input.error instanceof Error
        ? input.error.message
        : "Carrier operation failed.",
    details: {
      provider: input.provider,
      method: input.method,
      status: resolveErrorStatus(input.error) ?? null,
    },
    correlation_id: input.correlation_id,
  })
}

export class ShippingProviderRouter {
  private readonly providers: Record<string, ShippingProvider>
  private readonly env: NodeJS.ProcessEnv
  private readonly scopeOrLogger?: unknown
  private readonly shipmentRepository?: ShipmentRepositoryLike
  private readonly retryConfig: RetryConfig
  private readonly circuitBreakerConfig: CircuitBreakerConfig
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private readonly now: () => number
  private readonly circuitState = new Map<string, CircuitState>()

  constructor(options: RouterOptions) {
    this.providers = normalizeProviderMap(options.providers ?? {})
    this.env = options.env ?? process.env
    this.scopeOrLogger = options.scopeOrLogger
    this.shipmentRepository = options.shipment_repository
    this.retryConfig = {
      max_attempts: Math.floor(
        readPositiveNumber(
          options.retry?.max_attempts ?? this.env.SHIPPING_ROUTER_RETRY_MAX_ATTEMPTS,
          3
        )
      ),
      base_delay_ms: Math.floor(
        readPositiveNumber(
          options.retry?.base_delay_ms ?? this.env.SHIPPING_ROUTER_RETRY_BASE_MS,
          200
        )
      ),
      jitter_ms: Math.floor(
        readPositiveNumber(
          options.retry?.jitter_ms ?? this.env.SHIPPING_ROUTER_RETRY_JITTER_MS,
          125
        )
      ),
    }
    this.circuitBreakerConfig = {
      consecutive_failures_threshold: Math.floor(
        readPositiveNumber(
          options.circuit_breaker?.consecutive_failures_threshold ??
            this.env.SHIPPING_ROUTER_BREAKER_CONSECUTIVE_FAILURES,
          3
        )
      ),
      error_rate_threshold_percent: readPositiveNumber(
        options.circuit_breaker?.error_rate_threshold_percent ??
          this.env.SHIPPING_ROUTER_BREAKER_ERROR_RATE_PERCENT,
        50
      ),
      rolling_window_size: Math.floor(
        readPositiveNumber(
          options.circuit_breaker?.rolling_window_size ??
            this.env.SHIPPING_ROUTER_BREAKER_WINDOW_SIZE,
          20
        )
      ),
      open_duration_ms: Math.floor(
        readPositiveNumber(
          options.circuit_breaker?.open_duration_ms ??
            this.env.SHIPPING_ROUTER_BREAKER_OPEN_MS,
          30_000
        )
      ),
    }
    this.sleep = options.sleep ?? (async (ms: number) => delay(ms))
    this.random = options.random ?? Math.random
    this.now = options.now ?? Date.now
  }

  getDefaultProviderId(correlationIdInput?: string): string {
    const correlationId = resolveCorrelationId(correlationIdInput)
    const configured = readText(this.env.SHIPPING_PROVIDER_DEFAULT).toLowerCase()
    if (configured) {
      this.getProviderOrThrow(configured, correlationId)
      return configured
    }

    const providerIds = Object.keys(this.providers)
    if (providerIds.length === 1) {
      return providerIds[0]
    }

    throw new ShippingProviderError({
      code: "PROVIDER_UNAVAILABLE",
      message:
        "Unable to resolve default shipping provider. Configure SHIPPING_PROVIDER_DEFAULT.",
      details: {
        available_providers: providerIds,
      },
      correlation_id: correlationId,
    })
  }

  async quote(
    input: RoutedRequestInput<QuoteRequest>
  ): Promise<QuoteResponse> {
    const correlationId = resolveCorrelationId(input.correlation_id)
    const providerId = this.resolveProviderId(input.provider, correlationId)
    const provider = this.getProviderOrThrow(providerId, correlationId)

    return this.invokeWithPolicy({
      provider_id: providerId,
      provider,
      method: "quote",
      correlation_id: correlationId,
      operation: () => provider.quote(input.request),
    })
  }

  async createShipment(
    input: RoutedRequestInput<CreateShipmentRequest>
  ): Promise<CreateShipmentResponse> {
    const correlationId = resolveCorrelationId(input.correlation_id)

    if (!readBool(this.env.SHIPPING_BOOKING_ENABLED, true)) {
      const error = new ShippingProviderError({
        code: "BOOKING_DISABLED",
        message: "Shipping booking is disabled by SHIPPING_BOOKING_ENABLED=false.",
        details: {},
        correlation_id: correlationId,
      })
      this.logCall({
        provider:
          readText(input.provider).toLowerCase() ||
          readText(this.env.SHIPPING_PROVIDER_DEFAULT).toLowerCase() ||
          "default",
        method: "createShipment",
        correlation_id: correlationId,
        started_at_ms: this.now(),
        success: false,
        error_code: error.code,
      })
      throw error
    }

    const providerId = this.resolveProviderId(input.provider, correlationId)
    const provider = this.getProviderOrThrow(providerId, correlationId)
    const supportsIdempotency =
      Boolean((provider.capabilities as Record<string, unknown>)?.supports_idempotency) &&
      Boolean(readText(input.request.internal_reference))

    return this.invokeWithPolicy({
      provider_id: providerId,
      provider,
      method: "createShipment",
      correlation_id: correlationId,
      allow_retry_override: supportsIdempotency,
      provider_shipment_id: readText(input.request.internal_reference) || undefined,
      operation: () => provider.createShipment(input.request),
    })
  }

  async lookupShipmentByReference(input: {
    provider?: string
    request: LookupShipmentByReferenceRequest
    correlation_id?: string
  }): Promise<CreateShipmentResponse | null> {
    const correlationId = resolveCorrelationId(input.correlation_id)
    const providerId = this.resolveProviderId(input.provider, correlationId)
    const provider = this.getProviderOrThrow(providerId, correlationId)

    if (
      !provider.capabilities.supports_reference_lookup ||
      typeof provider.findShipmentByReference !== "function"
    ) {
      throw new ShippingProviderError({
        code: "NOT_SUPPORTED",
        message: `Provider ${providerId} does not support shipment lookup by internal reference.`,
        details: {
          provider: providerId,
          method: "lookupShipmentByReference",
        },
        correlation_id: correlationId,
      })
    }

    return this.invokeWithPolicy({
      provider_id: providerId,
      provider,
      method: "lookupShipmentByReference",
      correlation_id: correlationId,
      provider_shipment_id: readText(input.request.internal_reference) || undefined,
      operation: () =>
        provider.findShipmentByReference!(input.request),
    })
  }

  async getLabel(
    input: RoutedRequestInput<GetLabelRequest>
  ): Promise<LabelResponse> {
    const correlationId = resolveCorrelationId(input.correlation_id)
    const providerId = this.resolveProviderId(input.provider, correlationId)
    const provider = this.getProviderOrThrow(providerId, correlationId)

    return this.invokeWithPolicy({
      provider_id: providerId,
      provider,
      method: "getLabel",
      correlation_id: correlationId,
      provider_shipment_id: readText(input.request.shipment_id) || undefined,
      operation: () => provider.getLabel(input.request),
    })
  }

  async track(input: TrackByShipmentInput): Promise<TrackingResponse> {
    const correlationId = resolveCorrelationId(input.correlation_id)
    const shipmentId = readText(input.shipment_id)
    if (!shipmentId) {
      throw new ShippingProviderError({
        code: "NOT_SUPPORTED",
        message: "shipment_id is required for tracking routing.",
        details: {},
        correlation_id: correlationId,
      })
    }

    if (!this.shipmentRepository) {
      throw new ShippingProviderError({
        code: "PROVIDER_UNAVAILABLE",
        message: "Shipment repository is required for track routing.",
        details: {},
        correlation_id: correlationId,
      })
    }

    const shipment = await this.shipmentRepository.getShipmentById(shipmentId)
    if (!shipment) {
      throw new ShippingProviderError({
        code: "NOT_SUPPORTED",
        message: `Shipment not found: ${shipmentId}`,
        details: {
          shipment_id: shipmentId,
        },
        correlation_id: correlationId,
      })
    }

    const providerId = readText(shipment.provider).toLowerCase()
    const provider = this.getProviderOrThrow(providerId, correlationId)

    const request: TrackRequest = {
      shipment_id: readText(shipment.provider_shipment_id) || undefined,
      tracking_number:
        readText(input.tracking_number) ||
        readText(shipment.provider_awb) ||
        undefined,
      internal_reference: readText(shipment.internal_reference) || undefined,
      correlation_id: correlationId,
    }

    if (
      !request.shipment_id &&
      !request.tracking_number &&
      !request.internal_reference
    ) {
      throw new ShippingProviderError({
        code: "NOT_SUPPORTED",
        message:
          "Unable to track shipment. provider_shipment_id/provider_awb/internal_reference are missing.",
        details: {
          shipment_id: shipmentId,
          provider: providerId,
        },
        correlation_id: correlationId,
      })
    }

    return this.invokeWithPolicy({
      provider_id: providerId,
      provider,
      method: "track",
      correlation_id: correlationId,
      shipment_id: shipmentId,
      provider_shipment_id: readText(request.shipment_id) || undefined,
      operation: () => provider.track(request),
    })
  }

  async cancelByShipment(
    input: CancelByShipmentInput
  ): Promise<CancelResponse> {
    const correlationId = resolveCorrelationId(input.correlation_id)
    const shipmentId = readText(input.shipment_id)
    if (!shipmentId) {
      throw new ShippingProviderError({
        code: "NOT_SUPPORTED",
        message: "shipment_id is required for cancel routing.",
        details: {},
        correlation_id: correlationId,
      })
    }

    if (!this.shipmentRepository) {
      throw new ShippingProviderError({
        code: "PROVIDER_UNAVAILABLE",
        message: "Shipment repository is required for cancel routing.",
        details: {},
        correlation_id: correlationId,
      })
    }

    const shipment = await this.shipmentRepository.getShipmentById(shipmentId)
    if (!shipment) {
      throw new ShippingProviderError({
        code: "NOT_SUPPORTED",
        message: `Shipment not found: ${shipmentId}`,
        details: {
          shipment_id: shipmentId,
        },
        correlation_id: correlationId,
      })
    }

    const internalStatus = readText(
      (shipment as Record<string, unknown>).status
    ).toUpperCase()
    if (internalStatus === "CANCELLED") {
      return {
        shipment_id: shipmentId,
        cancelled: true,
        status: "CANCELLED",
      }
    }

    if (internalStatus === "IN_TRANSIT" || internalStatus === "DELIVERED") {
      throw new ShippingProviderError({
        code: "CANNOT_CANCEL_IN_STATE",
        message: `Shipment cannot be cancelled in state ${internalStatus}.`,
        details: {
          shipment_id: shipmentId,
          provider: readText(shipment.provider).toLowerCase() || null,
          status: internalStatus,
        },
        correlation_id: correlationId,
      })
    }

    const providerId = readText(shipment.provider).toLowerCase()
    const provider = this.getProviderOrThrow(providerId, correlationId)
    const providerShipmentId =
      readText(shipment.provider_shipment_id) ||
      readText(shipment.provider_awb) ||
      undefined

    if (!providerShipmentId) {
      throw new ShippingProviderError({
        code: "NOT_SUPPORTED",
        message:
          "Unable to cancel shipment. provider_shipment_id/provider_awb are missing.",
        details: {
          shipment_id: shipmentId,
          provider: providerId,
        },
        correlation_id: correlationId,
      })
    }

    const request: CancelRequest = {
      shipment_id: providerShipmentId,
      reason: readText(input.reason) || undefined,
      correlation_id: correlationId,
    }

    const cancelled = await this.invokeWithPolicy({
      provider_id: providerId,
      provider,
      method: "cancel",
      correlation_id: correlationId,
      shipment_id: shipmentId,
      provider_shipment_id: providerShipmentId,
      operation: () => provider.cancel(request),
    })

    if (
      cancelled.cancelled &&
      typeof this.shipmentRepository.updateShipmentStatusMonotonic === "function"
    ) {
      await this.shipmentRepository.updateShipmentStatusMonotonic({
        shipment_id: shipmentId,
        next_status: "CANCELLED",
      })
    }

    return cancelled
  }

  async cancel(
    input: RoutedRequestInput<CancelRequest>
  ): Promise<CancelResponse> {
    const correlationId = resolveCorrelationId(input.correlation_id)

    if (this.shipmentRepository) {
      const routedShipmentId = readText(input.request.shipment_id)
      if (routedShipmentId) {
        const shipment = await this.shipmentRepository.getShipmentById(
          routedShipmentId
        )
        if (shipment) {
          return this.cancelByShipment({
            shipment_id: routedShipmentId,
            reason: input.request.reason,
            correlation_id: correlationId,
          })
        }
      }
    }

    const providerId = this.resolveProviderId(input.provider, correlationId)
    const provider = this.getProviderOrThrow(providerId, correlationId)

    return this.invokeWithPolicy({
      provider_id: providerId,
      provider,
      method: "cancel",
      correlation_id: correlationId,
      provider_shipment_id: readText(input.request.shipment_id) || undefined,
      operation: () =>
        provider.cancel({
          ...input.request,
          correlation_id: correlationId,
        }),
    })
  }

  async healthCheck(input: {
    provider?: string
    correlation_id?: string
  } = {}): Promise<HealthCheckResponse> {
    const correlationId = resolveCorrelationId(input.correlation_id)
    const providerId = this.resolveProviderId(input.provider, correlationId)
    const provider = this.getProviderOrThrow(providerId, correlationId)

    return this.invokeWithPolicy({
      provider_id: providerId,
      provider,
      method: "healthCheck",
      correlation_id: correlationId,
      operation: () => provider.healthCheck(),
    })
  }

  private resolveProviderId(
    providerInput: string | undefined,
    correlationId: string
  ): string {
    const explicit = readText(providerInput).toLowerCase()
    if (explicit) {
      return explicit
    }

    return this.getDefaultProviderId(correlationId)
  }

  private getProviderOrThrow(
    providerId: string,
    correlationId: string
  ): ShippingProvider {
    const provider = this.providers[readText(providerId).toLowerCase()]
    if (provider) {
      return provider
    }

    throw new ShippingProviderError({
      code: "PROVIDER_UNAVAILABLE",
      message: `Shipping provider not available: ${providerId || "<empty>"}`,
      details: {
        provider: providerId,
      },
      correlation_id: correlationId,
    })
  }

  private getCircuitKey(providerId: string, method: ShippingRouterMethod): string {
    return `${providerId}:${method}`
  }

  private getOrCreateCircuitState(key: string): CircuitState {
    const existing = this.circuitState.get(key)
    if (existing) {
      return existing
    }

    const created: CircuitState = {
      open_until_ms: null,
      consecutive_failures: 0,
      outcomes: [],
    }
    this.circuitState.set(key, created)
    return created
  }

  private isCircuitOpen(key: string): boolean {
    const state = this.getOrCreateCircuitState(key)
    const openUntil = state.open_until_ms
    if (!openUntil) {
      return false
    }

    if (this.now() >= openUntil) {
      state.open_until_ms = null
      return false
    }

    return true
  }

  private recordSuccess(key: string): void {
    const state = this.getOrCreateCircuitState(key)
    state.consecutive_failures = 0
    state.outcomes.push(true)
    if (state.outcomes.length > this.circuitBreakerConfig.rolling_window_size) {
      state.outcomes.shift()
    }
  }

  private recordFailure(key: string): void {
    const state = this.getOrCreateCircuitState(key)
    state.consecutive_failures += 1
    state.outcomes.push(false)
    if (state.outcomes.length > this.circuitBreakerConfig.rolling_window_size) {
      state.outcomes.shift()
    }

    const failureCount = state.outcomes.filter((outcome) => !outcome).length
    const errorRatePercent =
      state.outcomes.length > 0
        ? (failureCount / state.outcomes.length) * 100
        : 0

    const openByConsecutive =
      state.consecutive_failures >=
      this.circuitBreakerConfig.consecutive_failures_threshold
    const openByErrorRate =
      state.outcomes.length >= this.circuitBreakerConfig.rolling_window_size &&
      errorRatePercent >= this.circuitBreakerConfig.error_rate_threshold_percent

    if (openByConsecutive || openByErrorRate) {
      state.open_until_ms = this.now() + this.circuitBreakerConfig.open_duration_ms
    }
  }

  private computeBackoffMs(attempt: number): number {
    const exponent = Math.max(0, attempt - 1)
    const base = this.retryConfig.base_delay_ms * Math.pow(2, exponent)
    const jitter = Math.floor(this.random() * this.retryConfig.jitter_ms)
    return base + jitter
  }

  private logCall(input: {
    provider: string
    method: ShippingRouterMethod
    correlation_id: string
    started_at_ms: number
    success: boolean
    error_code?: string
    shipment_id?: string
    provider_shipment_id?: string
  }): void {
    const durationMs = Math.max(0, this.now() - input.started_at_ms)
    logProviderCall(
      {
        provider: input.provider,
        method: input.method,
        duration_ms: durationMs,
        success: input.success,
        error_code: input.error_code ?? null,
        correlation_id: input.correlation_id,
        shipment_id: input.shipment_id,
        provider_shipment_id: input.provider_shipment_id,
      },
      {
        scopeOrLogger: this.scopeOrLogger,
      }
    )
  }

  private async invokeWithPolicy<T>(input: {
    provider_id: string
    provider: ShippingProvider
    method: ShippingRouterMethod
    correlation_id: string
    operation: () => Promise<T>
    allow_retry_override?: boolean
    shipment_id?: string
    provider_shipment_id?: string
  }): Promise<T> {
    const startedAt = this.now()
    const circuitKey = this.getCircuitKey(input.provider_id, input.method)

    if (this.isCircuitOpen(circuitKey)) {
      const circuitError = new ShippingProviderError({
        code: "PROVIDER_UNAVAILABLE",
        message: "Provider circuit breaker is open.",
        details: {
          provider: input.provider_id,
          method: input.method,
        },
        correlation_id: input.correlation_id,
      })
      this.logCall({
        provider: input.provider_id,
        method: input.method,
        correlation_id: input.correlation_id,
        started_at_ms: startedAt,
        success: false,
        error_code: circuitError.code,
        shipment_id: input.shipment_id,
        provider_shipment_id: input.provider_shipment_id,
      })
      throw circuitError
    }

    const retryAllowed =
      input.allow_retry_override === true ||
      RETRYABLE_METHODS.has(input.method)
    const maxAttempts = retryAllowed ? Math.max(1, this.retryConfig.max_attempts) : 1

    let lastError: ShippingProviderError | null = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await input.operation()
        this.recordSuccess(circuitKey)
        this.logCall({
          provider: input.provider_id,
          method: input.method,
          correlation_id: input.correlation_id,
          started_at_ms: startedAt,
          success: true,
          shipment_id: input.shipment_id,
          provider_shipment_id: input.provider_shipment_id,
        })
        return result
      } catch (error) {
        const normalized = toShippingProviderError({
          error,
          correlation_id: input.correlation_id,
          provider: input.provider_id,
          method: input.method,
        })
        lastError = normalized

        const shouldRetry =
          retryAllowed &&
          attempt < maxAttempts &&
          isRetryableError(error)

        if (shouldRetry) {
          await this.sleep(this.computeBackoffMs(attempt))
          continue
        }

        this.recordFailure(circuitKey)
        this.logCall({
          provider: input.provider_id,
          method: input.method,
          correlation_id: input.correlation_id,
          started_at_ms: startedAt,
          success: false,
          error_code: normalized.code,
          shipment_id: input.shipment_id,
          provider_shipment_id: input.provider_shipment_id,
        })
        throw normalized
      }
    }

    const fallbackError =
      lastError ??
      new ShippingProviderError({
        code: "UPSTREAM_ERROR",
        message: "Carrier operation failed.",
        details: {
          provider: input.provider_id,
          method: input.method,
        },
        correlation_id: input.correlation_id,
      })

    this.recordFailure(circuitKey)
    this.logCall({
      provider: input.provider_id,
      method: input.method,
      correlation_id: input.correlation_id,
      started_at_ms: startedAt,
      success: false,
      error_code: fallbackError.code,
      shipment_id: input.shipment_id,
      provider_shipment_id: input.provider_shipment_id,
    })
    throw fallbackError
  }
}

export function toShippingRouterErrorObject(
  error: unknown,
  correlationId: string
): ShippingProviderErrorObject {
  if (error instanceof ShippingProviderError) {
    return error.toErrorObject()
  }

  return new ShippingProviderError({
    code: "UPSTREAM_ERROR",
    message: error instanceof Error ? error.message : "Carrier operation failed.",
    details: {},
    correlation_id: correlationId,
  }).toErrorObject()
}
