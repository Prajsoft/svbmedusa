import crypto from "crypto"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  ContainerRegistrationKeys,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { validateRazorpayConfig } from "./config"
import {
  type RazorpayApiCallError,
  type RazorpayClient,
  getRazorpayClient,
  razorpayRequest,
} from "./client"
import { RazorpayWebhookEventRepository } from "./webhook-event-repository"
import { logProviderCall, logWebhookEvent } from "../../../payments/observability"
import { logEvent } from "../logging/log-event"
import { increment } from "../observability/metrics"
import {
  PaymentErrorCode,
  PaymentProviderError,
  PaymentStatus as InternalPaymentStatus,
  type PaymentStatus as InternalPaymentStatusType,
  getPaymentPresentationData,
  logPaymentProviderEvent,
  normalizePaymentStatus,
  resolveWebhookProviderDefinition,
  type PaymentWebhookProviderDefinition,
  type ProviderWebhookVerificationResult,
  shouldAllowUnverifiedWebhook,
  transitionPaymentStatus,
} from "../payments-core"

const DEFAULT_PAYMENTS_MODE = "test"
const SESSION_LOCK_PREFIX = "razorpay:session-order"
const SESSION_ORDER_TABLE = "razorpay_session_order_v1"

type LoggerLike = {
  info?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
}

type QueryResultLike = {
  rows?: Array<Record<string, unknown>>
}

type PgConnectionLike = {
  raw: (query: string, bindings?: unknown[]) => Promise<QueryResultLike>
  transaction: <T>(handler: (trx: PgConnectionLike) => Promise<T>) => Promise<T>
}

type RazorpayOptions = {
  key_id?: string
  key_secret?: string
  webhook_secret?: string
  payments_mode?: "test" | "live"
  test_auto_authorize?: boolean
  allow_unverified_webhooks?: boolean
}

type RazorpayOrderResponse = {
  id?: string
}

type RazorpayPaymentResponse = {
  id?: string
  order_id?: string
  amount?: number
  currency?: string
  status?: string
}

type RazorpayRefundResponse = {
  id?: string
  payment_id?: string
  amount?: number
  currency?: string
  status?: string
}

type RazorpayWebhookPaymentEntity = {
  id?: string
  order_id?: string
  amount?: number
  currency?: string
  status?: string
  notes?: Record<string, unknown>
}

type RazorpayWebhookEvent = {
  event?: string
  payload?: {
    payment?: {
      entity?: RazorpayWebhookPaymentEntity
    }
  }
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false
    }
  }

  return fallback
}

function readNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function toMinorAmount(value: unknown): number {
  const numeric = readNumber(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0
  }

  const parsed = Number.isInteger(numeric)
    ? Math.round(numeric)
    : Math.round(numeric * 100)
  return parsed > 0 ? parsed : 0
}

function normalizeCurrency(value: unknown): string {
  return readText(value).toUpperCase()
}

function resolveHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const direct = headers[name]
  if (Array.isArray(direct)) {
    return readText(direct[0])
  }
  if (typeof direct === "string") {
    return readText(direct)
  }

  const normalizedName = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== normalizedName) {
      continue
    }
    const candidate = headers[key]
    if (Array.isArray(candidate)) {
      return readText(candidate[0])
    }
    if (typeof candidate === "string") {
      return readText(candidate)
    }
  }

  return ""
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value
  }

  if (
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "Buffer" &&
    Array.isArray((value as { data?: unknown[] }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data)
  }

  if (typeof value === "string") {
    return Buffer.from(value)
  }

  return Buffer.from(JSON.stringify(value ?? {}))
}

function toInternalStatusFromRazorpay(value: unknown): InternalPaymentStatusType {
  const normalized = readText(value).toLowerCase()
  if (!normalized || normalized === "created" || normalized === "pending") {
    return InternalPaymentStatus.PENDING
  }

  if (normalized === "authorized") {
    return InternalPaymentStatus.AUTHORIZED
  }

  if (normalized === "captured") {
    return InternalPaymentStatus.CAPTURED
  }

  if (normalized === "refunded") {
    return InternalPaymentStatus.REFUNDED
  }

  if (normalized === "failed") {
    return InternalPaymentStatus.FAILED
  }

  if (normalized === "canceled" || normalized === "cancelled") {
    return InternalPaymentStatus.CANCELED
  }

  return normalizePaymentStatus(normalized)
}

function toRazorpayStatusFromInternal(status: InternalPaymentStatusType): string {
  if (status === InternalPaymentStatus.AUTHORIZED) {
    return "authorized"
  }
  if (status === InternalPaymentStatus.CAPTURED) {
    return "captured"
  }
  if (status === InternalPaymentStatus.REFUNDED) {
    return "refunded"
  }
  if (status === InternalPaymentStatus.FAILED) {
    return "failed"
  }
  if (status === InternalPaymentStatus.CANCELED) {
    return "canceled"
  }

  return "created"
}

function mapInternalStatusToPaymentSessionStatus(
  status: InternalPaymentStatusType
): PaymentSessionStatus {
  if (status === InternalPaymentStatus.AUTHORIZED) {
    return PaymentSessionStatus.AUTHORIZED
  }

  if (
    status === InternalPaymentStatus.CAPTURED ||
    status === InternalPaymentStatus.REFUNDED
  ) {
    return PaymentSessionStatus.CAPTURED
  }

  if (status === InternalPaymentStatus.FAILED) {
    return PaymentSessionStatus.ERROR
  }

  if (status === InternalPaymentStatus.CANCELED) {
    return PaymentSessionStatus.CANCELED
  }

  return PaymentSessionStatus.PENDING
}

function mapPaymentStatus(value: string): PaymentSessionStatus {
  return mapInternalStatusToPaymentSessionStatus(toInternalStatusFromRazorpay(value))
}

function mapWebhookAction(eventType: string): PaymentActions {
  const normalized = eventType.trim().toLowerCase()

  if (normalized === "payment.authorized") {
    return PaymentActions.AUTHORIZED
  }

  if (normalized === "payment.captured") {
    return PaymentActions.SUCCESSFUL
  }

  if (normalized === "payment.failed") {
    return PaymentActions.FAILED
  }

  return PaymentActions.NOT_SUPPORTED
}

function toWebhookVerificationReason(
  verification: ProviderWebhookVerificationResult
): "missing_webhook_secret" | "missing_signature_header" | "signature_mismatch" {
  const message = readText(verification.message).toLowerCase()
  if (message.includes("without razorpay_webhook_secret")) {
    return "missing_webhook_secret"
  }
  if (message.includes("missing webhook signature header")) {
    return "missing_signature_header"
  }

  return "signature_mismatch"
}

function randomId(prefix: string): string {
  const compact = crypto.randomUUID().replace(/-/g, "")
  return `${prefix}_${compact.slice(0, 16)}`
}

export default class RazorpayPaymentProviderService extends AbstractPaymentProvider<RazorpayOptions> {
  static identifier = "razorpay"

  static validateOptions(options: Record<string, unknown>): void {
    validateRazorpayConfig({
      PAYMENTS_MODE: options.payments_mode,
      RAZORPAY_KEY_ID: options.key_id,
      RAZORPAY_KEY_SECRET: options.key_secret,
      RAZORPAY_WEBHOOK_SECRET: options.webhook_secret,
    })
  }

  protected readonly logger: LoggerLike
  protected readonly pgConnection?: PgConnectionLike
  protected readonly keyId: string
  protected readonly keySecret: string
  protected readonly webhookSecret: string
  protected readonly paymentsMode: "test" | "live"
  protected readonly testAutoAuthorize: boolean
  protected readonly allowUnverifiedWebhooks: boolean
  protected readonly razorpayClient: RazorpayClient
  protected readonly webhookEventRepository?: RazorpayWebhookEventRepository
  protected tablesEnsured = false

  constructor(cradle: Record<string, unknown>, config: RazorpayOptions = {}) {
    super(cradle, config)

    this.logger = ((cradle as Record<string, unknown>).logger as LoggerLike) ?? console
    this.pgConnection = (cradle as Record<string, unknown>)[
      ContainerRegistrationKeys.PG_CONNECTION
    ] as PgConnectionLike | undefined

    this.keyId = readText(config.key_id) || readText(process.env.RAZORPAY_KEY_ID)
    this.keySecret =
      readText(config.key_secret) || readText(process.env.RAZORPAY_KEY_SECRET)
    this.webhookSecret =
      readText(config.webhook_secret) ||
      readText(process.env.RAZORPAY_WEBHOOK_SECRET)

    const rawMode =
      readText(config.payments_mode) ||
      readText(process.env.PAYMENTS_MODE) ||
      DEFAULT_PAYMENTS_MODE
    this.paymentsMode = rawMode.toLowerCase() === "live" ? "live" : "test"

    this.testAutoAuthorize = readBoolean(
      config.test_auto_authorize ?? process.env.RAZORPAY_TEST_AUTO_AUTHORIZE,
      this.paymentsMode === "test"
    )
    this.allowUnverifiedWebhooks = shouldAllowUnverifiedWebhook({
      allow_unverified_webhooks: config.allow_unverified_webhooks,
    })
    this.razorpayClient = getRazorpayClient({
      keyId: this.keyId,
      keySecret: this.keySecret,
    })
    this.webhookEventRepository = this.pgConnection
      ? new RazorpayWebhookEventRepository(this.pgConnection)
      : undefined
  }

  private resolveCorrelationId(input?: {
    data?: Record<string, unknown>
    context?: { idempotency_key?: string }
  }): string {
    const fromData = readText(input?.data?.correlation_id)
    if (fromData) {
      return fromData
    }

    return crypto.randomUUID()
  }

  private log(
    level: "info" | "warn" | "error",
    message: string,
    correlationId: string,
    details: Record<string, unknown> = {}
  ): void {
    logEvent(
      message,
      {
        scope: "payment_razorpay",
        ...details,
      },
      correlationId,
      {
        level,
        scopeOrLogger: this.logger,
      }
    )
  }

  private throwProviderError(input: {
    code: string
    message: string
    correlationId: string
    httpStatus?: number
    details?: Record<string, unknown>
  }): never {
    throw new PaymentProviderError({
      code: input.code,
      message: input.message,
      correlation_id: input.correlationId,
      http_status: input.httpStatus ?? 500,
      details: input.details,
    })
  }

  private transitionProviderStatus(input: {
    data: Record<string, unknown>
    next_status: unknown
    correlationId: string
    onInvalid?: "throw" | "noop"
  }): {
    changed: boolean
    valid: boolean
    next_internal_status: InternalPaymentStatusType
  } {
    const currentInternalStatus = toInternalStatusFromRazorpay(
      input.data.razorpay_payment_status
    )
    const nextInternalStatus = toInternalStatusFromRazorpay(input.next_status)
    const transition = transitionPaymentStatus({
      current: currentInternalStatus,
      next: nextInternalStatus,
      correlation_id: input.correlationId,
      on_invalid: input.onInvalid,
    })

    if (transition.valid) {
      input.data.payment_status = transition.next
      input.data.razorpay_payment_status = toRazorpayStatusFromInternal(transition.next)
    }

    if (transition.changed) {
      this.log("info", "PAYMENT_STATE_TRANSITION_APPLIED", input.correlationId, {
        from: transition.current,
        to: transition.next,
      })
    } else if (!transition.valid) {
      this.log("warn", "PAYMENT_STATE_TRANSITION_SKIPPED", input.correlationId, {
        from: currentInternalStatus,
        to: nextInternalStatus,
        reason: "invalid_transition_noop",
      })
    }

    return {
      changed: transition.changed,
      valid: transition.valid,
      next_internal_status: transition.next,
    }
  }

  private ensureInrCurrency(currency: unknown, correlationId: string): string {
    const normalized = normalizeCurrency(currency)
    if (normalized !== "INR") {
      this.throwProviderError({
        code: PaymentErrorCode.CURRENCY_NOT_SUPPORTED,
        message: "Only INR is supported for Razorpay.",
        correlationId,
        httpStatus: 400,
        details: {
          currency: normalized || null,
        },
      })
    }

    return normalized
  }

  private ensureConfigured(correlationId: string): void {
    if (!this.keyId || !this.keySecret) {
      this.throwProviderError({
        code: PaymentErrorCode.RAZORPAY_CONFIG_MISSING,
        message: "Razorpay key configuration is missing.",
        correlationId,
        httpStatus: 500,
      })
    }
  }

  private async ensureTables(correlationId: string): Promise<void> {
    if (this.tablesEnsured) {
      return
    }

    if (!this.pgConnection) {
      this.throwProviderError({
        code: "RAZORPAY_DB_CONNECTION_MISSING",
        message:
          "Database connection is unavailable for Razorpay idempotency guarantees.",
        correlationId,
        httpStatus: 500,
      })
    }

    await this.pgConnection.raw(`
      CREATE TABLE IF NOT EXISTS ${SESSION_ORDER_TABLE} (
        payment_session_id TEXT PRIMARY KEY,
        razorpay_order_id TEXT NOT NULL UNIQUE,
        amount BIGINT,
        currency_code TEXT,
        attempt_count INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await this.pgConnection.raw(`
      ALTER TABLE ${SESSION_ORDER_TABLE}
      ADD COLUMN IF NOT EXISTS amount BIGINT
    `)
    await this.pgConnection.raw(`
      ALTER TABLE ${SESSION_ORDER_TABLE}
      ADD COLUMN IF NOT EXISTS currency_code TEXT
    `)
    await this.pgConnection.raw(`
      ALTER TABLE ${SESSION_ORDER_TABLE}
      ADD COLUMN IF NOT EXISTS attempt_count INTEGER
    `)
    await this.pgConnection.raw(`
      UPDATE ${SESSION_ORDER_TABLE}
      SET amount = COALESCE(amount, 0),
          currency_code = COALESCE(NULLIF(currency_code, ''), 'INR'),
          attempt_count = COALESCE(attempt_count, 1)
    `)
    await this.webhookEventRepository!.ensureSchema()

    await this.pgConnection.raw(`
      CREATE INDEX IF NOT EXISTS idx_${SESSION_ORDER_TABLE}_order_id
      ON ${SESSION_ORDER_TABLE} (razorpay_order_id)
    `)

    this.tablesEnsured = true
    this.log("info", "Ensured Razorpay persistence tables.", correlationId)
  }

  private async requestWithRetry<T>(input: {
    path: string
    method: "GET" | "POST"
    correlationId: string
    body?: Record<string, unknown>
  }): Promise<T> {
    this.ensureConfigured(input.correlationId)

    const startedAt = Date.now()
    const endpoint = this.resolveEndpointAlias(input)
    const retryOnRateLimit = this.shouldRetryRateLimitedCall(input)
    const requestCall = this.resolveRazorpayCall<T>(input)

    try {
      logPaymentProviderEvent(
        "PAYMENT_PROVIDER_CALL_ATTEMPT",
        {
          provider: "razorpay",
          correlation_id: input.correlationId,
          endpoint,
          details: {
            method: input.method,
            path: input.path,
            retry_on_429: retryOnRateLimit,
          },
        },
        { scopeOrLogger: this.logger }
      )
      const result = await razorpayRequest(
        requestCall,
        {
          correlation_id: input.correlationId,
          endpoint,
          scopeOrLogger: this.logger,
        },
        {
          shouldRetry: ({ status }) => {
            if (status === 429) {
              return retryOnRateLimit
            }
            return true
          },
        }
      )
      logProviderCall(
        {
          provider: "razorpay",
          method: endpoint,
          duration_ms: Date.now() - startedAt,
          success: true,
          correlation_id: input.correlationId,
        },
        {
          scopeOrLogger: this.logger,
        }
      )
      logPaymentProviderEvent(
        "PAYMENT_PROVIDER_CALL_SUCCESS",
        {
          provider: "razorpay",
          correlation_id: input.correlationId,
          endpoint,
          details: {
            method: input.method,
            path: input.path,
            retry_on_429: retryOnRateLimit,
          },
        },
        { scopeOrLogger: this.logger }
      )
      return result
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        logProviderCall(
          {
            provider: "razorpay",
            method: endpoint,
            duration_ms: Date.now() - startedAt,
            success: false,
            error_code: error.code,
            correlation_id: error.correlation_id || input.correlationId,
          },
          {
            scopeOrLogger: this.logger,
          }
        )
        throw error
      }

      if (this.isRazorpayApiCallError(error)) {
        const upstreamStatus = error.http_status
        const providerMessage =
          readText(error.sanitized_upstream.description) ||
          readText(error.sanitized_upstream.reason) ||
          readText(error.sanitized_upstream.code) ||
          `HTTP ${upstreamStatus}`

        let code = PaymentErrorCode.RAZORPAY_UPSTREAM_ERROR
        let httpStatus = 502
        if (upstreamStatus === 401 || upstreamStatus === 403) {
          code = PaymentErrorCode.RAZORPAY_AUTH_FAILED
        } else if (upstreamStatus === 400) {
          code = PaymentErrorCode.RAZORPAY_BAD_REQUEST
          httpStatus = 400
        } else if (upstreamStatus === 429) {
          code = PaymentErrorCode.RAZORPAY_RATE_LIMIT
          httpStatus = 429
        }

        logPaymentProviderEvent(
          "PAYMENT_PROVIDER_CALL_FAIL",
          {
            provider: "razorpay",
            correlation_id: error.correlation_id,
            endpoint: error.endpoint,
            status: upstreamStatus,
            details: {
              method: input.method,
              path: input.path,
              retry_on_429: retryOnRateLimit,
            },
          },
          { level: "error", scopeOrLogger: this.logger }
        )
        logProviderCall(
          {
            provider: "razorpay",
            method: endpoint,
            duration_ms: Date.now() - startedAt,
            success: false,
            error_code: code,
            correlation_id: error.correlation_id,
          },
          {
            scopeOrLogger: this.logger,
          }
        )

        this.throwProviderError({
          code,
          message: `Razorpay API request failed: ${providerMessage}`,
          correlationId: error.correlation_id,
          httpStatus,
          details: {
            status: upstreamStatus,
            path: input.path,
            endpoint: error.endpoint,
            sanitized_upstream: error.sanitized_upstream,
          },
        })
      }

      logPaymentProviderEvent(
        "PAYMENT_PROVIDER_CALL_FAIL",
        {
          provider: "razorpay",
          correlation_id: input.correlationId,
          endpoint,
          status: 502,
          details: {
            method: input.method,
            path: input.path,
            retry_on_429: retryOnRateLimit,
          },
        },
        { level: "error", scopeOrLogger: this.logger }
      )
      logProviderCall(
        {
          provider: "razorpay",
          method: endpoint,
          duration_ms: Date.now() - startedAt,
          success: false,
          error_code: PaymentErrorCode.RAZORPAY_UPSTREAM_ERROR,
          correlation_id: input.correlationId,
        },
        {
          scopeOrLogger: this.logger,
        }
      )

      this.throwProviderError({
        code: "RAZORPAY_API_REQUEST_FAILED",
        message: "Razorpay API request failed.",
        correlationId: input.correlationId,
        httpStatus: 502,
        details: {
          path: input.path,
          error: error instanceof Error ? error.message : "Unknown upstream error",
        },
      })
    }
  }

  private isRazorpayApiCallError(error: unknown): error is RazorpayApiCallError {
    return (
      Boolean(error) &&
      typeof error === "object" &&
      readText((error as Record<string, unknown>).code) === "RAZORPAY_API_CALL_FAILED" &&
      typeof (error as Record<string, unknown>).http_status === "number" &&
      typeof (error as Record<string, unknown>).endpoint === "string" &&
      typeof (error as Record<string, unknown>).correlation_id === "string" &&
      typeof (error as Record<string, unknown>).sanitized_upstream === "object"
    )
  }

  private resolveEndpointAlias(input: {
    method: "GET" | "POST"
    path: string
  }): string {
    if (input.method === "POST" && input.path === "/v1/orders") {
      return "orders.create"
    }

    if (input.method === "GET" && /^\/v1\/payments\/[^/]+$/.test(input.path)) {
      return "payments.fetch"
    }

    if (input.method === "POST" && /^\/v1\/payments\/[^/]+\/capture$/.test(input.path)) {
      return "payments.capture"
    }

    if (input.method === "POST" && /^\/v1\/payments\/[^/]+\/refund$/.test(input.path)) {
      return "payments.refund"
    }

    return `${input.method} ${input.path}`
  }

  private shouldRetryRateLimitedCall(input: {
    method: "GET" | "POST"
    path: string
  }): boolean {
    if (input.method === "GET" && /^\/v1\/payments\/[^/]+$/.test(input.path)) {
      return true
    }

    return false
  }

  private resolveRazorpayCall<T>(input: {
    path: string
    method: "GET" | "POST"
    body?: Record<string, unknown>
  }): () => Promise<T> {
    if (input.method === "POST" && input.path === "/v1/orders") {
      return () =>
        this.razorpayClient.orders.create(input.body ?? {}) as unknown as Promise<T>
    }

    const fetchPayment = input.path.match(/^\/v1\/payments\/([^/]+)$/)
    if (input.method === "GET" && fetchPayment) {
      const paymentId = readText(fetchPayment[1])
      return () => this.razorpayClient.payments.fetch(paymentId) as unknown as Promise<T>
    }

    const capturePayment = input.path.match(/^\/v1\/payments\/([^/]+)\/capture$/)
    if (input.method === "POST" && capturePayment) {
      const paymentId = readText(capturePayment[1])
      const amount = toMinorAmount(input.body?.amount)
      const currency = normalizeCurrency(input.body?.currency)
      return () =>
        this.razorpayClient.payments.capture(
          paymentId,
          amount,
          currency
        ) as unknown as Promise<T>
    }

    const refundPayment = input.path.match(/^\/v1\/payments\/([^/]+)\/refund$/)
    if (input.method === "POST" && refundPayment) {
      const paymentId = readText(refundPayment[1])
      const amount = toMinorAmount(input.body?.amount)
      return () =>
        this.razorpayClient.payments.refund(paymentId, {
          amount,
        }) as unknown as Promise<T>
    }

    return () =>
      Promise.reject(
        new Error(`Unsupported Razorpay endpoint in provider: ${input.method} ${input.path}`)
      )
  }

  private async createRazorpayOrder(input: {
    sessionId: string
    amount: number
    currencyCode: string
    correlationId: string
  }): Promise<string> {
    this.log("info", "RAZORPAY_ORDER_CREATE_ATTEMPT", input.correlationId, {
      session_id: input.sessionId,
      amount: input.amount,
      currency_code: input.currencyCode,
    })

    let response: RazorpayOrderResponse
    try {
      response = await this.requestWithRetry<RazorpayOrderResponse>({
        path: "/v1/orders",
        method: "POST",
        correlationId: input.correlationId,
        body: {
          amount: input.amount,
          currency: input.currencyCode,
          receipt: input.sessionId.slice(0, 40),
          notes: {
            session_id: input.sessionId,
            correlation_id: input.correlationId,
          },
        },
      })
    } catch (error) {
      increment("razorpay.order_create.fail")
      throw error
    }

    const orderId = readText(response.id)
    if (!orderId) {
      increment("razorpay.order_create.fail")
      this.throwProviderError({
        code: "RAZORPAY_ORDER_ID_MISSING",
        message: "Razorpay order creation did not return an order id.",
        correlationId: input.correlationId,
        httpStatus: 502,
      })
    }

    this.log("info", "RAZORPAY_ORDER_CREATED", input.correlationId, {
      session_id: input.sessionId,
      razorpay_order_id: orderId,
      amount: input.amount,
      currency: input.currencyCode,
      currency_code: input.currencyCode,
    })
    increment("razorpay.order_create.success")

    return orderId
  }

  private async getSessionOrderIdByOrderId(
    razorpayOrderId: string,
    correlationId: string
  ): Promise<string> {
    await this.ensureTables(correlationId)

    const result = await this.pgConnection!.raw(
      `SELECT payment_session_id FROM ${SESSION_ORDER_TABLE} WHERE razorpay_order_id = ?`,
      [razorpayOrderId]
    )

    return readText(result.rows?.[0]?.payment_session_id)
  }

  private async createOrGetOrderForSession(input: {
    sessionId: string
    amount: number
    currencyCode: string
    correlationId: string
  }): Promise<string> {
    await this.ensureTables(input.correlationId)

    const lockKey = `${SESSION_LOCK_PREFIX}:${input.sessionId}`
    return await this.pgConnection!.transaction(async (trx) => {
      await trx.raw(`SELECT pg_advisory_xact_lock(hashtext(?))`, [lockKey])

      const existing = await trx.raw(
        `
          SELECT razorpay_order_id, amount, currency_code, attempt_count
          FROM ${SESSION_ORDER_TABLE}
          WHERE payment_session_id = ?
        `,
        [input.sessionId]
      )
      const existingOrderId = readText(existing.rows?.[0]?.razorpay_order_id)
      if (existingOrderId) {
        const existingAmount = readNumber(existing.rows?.[0]?.amount)
        const existingCurrency = normalizeCurrency(existing.rows?.[0]?.currency_code)

        if (existingAmount > 0 && Math.round(existingAmount) !== input.amount) {
          this.throwProviderError({
            code: "RAZORPAY_AMOUNT_IMMUTABLE",
            message:
              "Razorpay order amount changed for the same payment session. Create a new session.",
            correlationId: input.correlationId,
            httpStatus: 409,
            details: {
              previous_amount: Math.round(existingAmount),
              next_amount: input.amount,
              session_id: input.sessionId,
            },
          })
        }

        if (existingCurrency && existingCurrency !== input.currencyCode) {
          this.throwProviderError({
            code: PaymentErrorCode.CURRENCY_NOT_SUPPORTED,
            message: "Only INR is supported for Razorpay.",
            correlationId: input.correlationId,
            httpStatus: 400,
            details: {
              currency: existingCurrency,
            },
          })
        }

        return existingOrderId
      }

      const createdOrderId = await this.createRazorpayOrder({
        sessionId: input.sessionId,
        amount: input.amount,
        currencyCode: input.currencyCode,
        correlationId: input.correlationId,
      })

      await trx.raw(
        `
          INSERT INTO ${SESSION_ORDER_TABLE}
            (payment_session_id, razorpay_order_id, amount, currency_code, attempt_count)
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT (payment_session_id) DO NOTHING
        `,
        [input.sessionId, createdOrderId, input.amount, input.currencyCode]
      )

      const stored = await trx.raw(
        `SELECT razorpay_order_id FROM ${SESSION_ORDER_TABLE} WHERE payment_session_id = ?`,
        [input.sessionId]
      )
      const storedOrderId = readText(stored.rows?.[0]?.razorpay_order_id)
      return storedOrderId || createdOrderId
    })
  }

  private mergePaymentData(
    data: Record<string, unknown>,
    payment: RazorpayPaymentResponse,
    correlationId: string
  ): void {
    const paymentId = readText(payment.id)
    if (paymentId) {
      data.razorpay_payment_id = paymentId
    }

    const orderId = readText(payment.order_id)
    if (orderId) {
      data.razorpay_order_id = orderId
    }

    const status = readText(payment.status).toLowerCase()
    if (status) {
      this.transitionProviderStatus({
        data,
        next_status: status,
        correlationId,
        onInvalid: "noop",
      })
    }

    const amount = toMinorAmount(payment.amount)
    if (amount > 0) {
      data.amount = amount
    }

    const currency = normalizeCurrency(payment.currency)
    if (currency) {
      data.currency_code = currency
    }
  }

  private isTimingSafeMatch(signature: string, expected: string): boolean {
    const signatureBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  }

  private isAlreadyVerifiedAuthorizationData(
    data: Record<string, unknown>
  ): boolean {
    const status = readText(data.razorpay_payment_status).toLowerCase()
    const paymentId = readText(data.razorpay_payment_id)
    const orderId = readText(data.razorpay_order_id)
    const verifiedAt = readText(data.verified_at)

    return Boolean(
      verifiedAt &&
        paymentId &&
        orderId &&
        (status === "authorized" || status === "captured")
    )
  }

  private isPaidStatusForCancel(status: string): boolean {
    return status === "authorized" || status === "captured" || status === "refunded"
  }

  private resolveAuthorizePayload(input: {
    data: Record<string, unknown>
    correlationId: string
  }): {
    orderId: string
    paymentId: string
    signature: string
  } {
    const orderId = readText(input.data.razorpay_order_id)
    const paymentId = readText(input.data.razorpay_payment_id)
    const signature = readText(input.data.razorpay_signature)
    const missingFields: string[] = []

    if (!orderId) {
      missingFields.push("razorpay_order_id")
    }

    if (!paymentId) {
      missingFields.push("razorpay_payment_id")
    }

    if (!signature) {
      missingFields.push("razorpay_signature")
    }

    if (missingFields.length > 0) {
      this.log("warn", "RAZORPAY_SIGNATURE_FAIL", input.correlationId, {
        reason: "missing_fields",
        missing_fields: missingFields,
        session_id: readText(input.data.session_id) || null,
      })
      this.log("warn", "RAZORPAY_SIGNATURE_VERIFICATION_FAIL", input.correlationId, {
        reason: "missing_fields",
        missing_fields: missingFields,
        session_id: readText(input.data.session_id) || null,
      })
      this.throwProviderError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: "Missing required Razorpay authorization fields.",
        correlationId: input.correlationId,
        httpStatus: 400,
        details: {
          missing_fields: missingFields,
        },
      })
    }

    return { orderId, paymentId, signature }
  }

  private verifyCheckoutSignature(input: {
    orderId: string
    paymentId: string
    signature: string
    correlationId: string
    sessionId?: string
  }): void {
    const expectedSignature = crypto
      .createHmac("sha256", this.keySecret)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest("hex")

    if (!this.isTimingSafeMatch(input.signature, expectedSignature)) {
      this.log("warn", "RAZORPAY_SIGNATURE_FAIL", input.correlationId, {
        reason: "signature_mismatch",
        razorpay_order_id: input.orderId,
        razorpay_payment_id: input.paymentId,
        session_id: input.sessionId || null,
      })
      this.log("warn", "RAZORPAY_SIGNATURE_VERIFICATION_FAIL", input.correlationId, {
        reason: "signature_mismatch",
        razorpay_order_id: input.orderId,
        razorpay_payment_id: input.paymentId,
        session_id: input.sessionId || null,
      })
      this.throwProviderError({
        code: PaymentErrorCode.SIGNATURE_INVALID,
        message: "Razorpay payment signature verification failed.",
        correlationId: input.correlationId,
        httpStatus: 401,
      })
    }

    this.log("info", "RAZORPAY_SIGNATURE_OK", input.correlationId, {
      razorpay_order_id: input.orderId,
      razorpay_payment_id: input.paymentId,
      session_id: input.sessionId || null,
    })
    this.log("info", "RAZORPAY_SIGNATURE_VERIFICATION_OK", input.correlationId, {
      razorpay_order_id: input.orderId,
      razorpay_payment_id: input.paymentId,
      session_id: input.sessionId || null,
    })
  }

  private async retrieveRazorpayPayment(
    paymentId: string,
    correlationId: string
  ): Promise<RazorpayPaymentResponse> {
    return this.requestWithRetry<RazorpayPaymentResponse>({
      path: `/v1/payments/${paymentId}`,
      method: "GET",
      correlationId,
    })
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const correlationId = this.resolveCorrelationId(input)
    const currencyCode = this.ensureInrCurrency(input.currency_code, correlationId)
    const amount = toMinorAmount(input.amount)
    const data = { ...(input.data ?? {}) }
    const sessionId = readText(data.session_id)

    if (!sessionId) {
      this.throwProviderError({
        code: "RAZORPAY_SESSION_ID_REQUIRED",
        message: "Missing Medusa payment session id for Razorpay order creation.",
        correlationId,
        httpStatus: 400,
      })
    }

    if (amount <= 0) {
      this.throwProviderError({
        code: "RAZORPAY_INVALID_AMOUNT",
        message: "Payment amount must be greater than zero.",
        correlationId,
        httpStatus: 400,
        details: {
          amount,
        },
      })
    }

    const existingAmount = toMinorAmount(data.amount)
    if (existingAmount > 0 && existingAmount !== amount) {
      this.throwProviderError({
        code: "RAZORPAY_AMOUNT_IMMUTABLE",
        message:
          "Razorpay order amount changed for the same payment session. Create a new session.",
        correlationId,
        httpStatus: 409,
        details: {
          previous_amount: existingAmount,
          next_amount: amount,
          session_id: sessionId,
        },
      })
    }

    const orderId = await this.createOrGetOrderForSession({
      sessionId,
      amount,
      currencyCode,
      correlationId,
    })
    const providerSessionId = readText(data.razorpay_session_id) || randomId("rzpsess")
    const now = new Date().toISOString()

    this.log("info", "Initialized Razorpay payment session.", correlationId, {
      session_id: sessionId,
      razorpay_order_id: orderId,
      amount,
      currency_code: currencyCode,
    })
    this.log("info", "RAZORPAY_CHECKOUT_INITIATED", correlationId, {
      session_id: sessionId,
      cart_id: readText(data.cart_id) || null,
      order_id: readText(data.order_id) || null,
      razorpay_order_id: orderId,
    })

    const nextData: Record<string, unknown> = {
      ...data,
      correlation_id: correlationId,
      session_id: sessionId,
      razorpay_session_id: providerSessionId,
      razorpay_order_id: orderId,
      razorpay_key_id: this.keyId,
      razorpay_payment_status: readText(data.razorpay_payment_status) || "created",
      payment_status:
        readText(data.payment_status) || InternalPaymentStatus.PENDING,
      amount,
      currency_code: currencyCode,
      initiated_at: readText(data.initiated_at) || now,
    }
    const presentationData = getPaymentPresentationData(
      "pp_razorpay_razorpay",
      nextData,
      {
        customer: input.context?.customer ?? null,
      }
    )
    if (presentationData) {
      nextData.presentation_data = presentationData
    }

    return {
      id: providerSessionId,
      status: PaymentSessionStatus.PENDING,
      data: nextData,
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const correlationId = this.resolveCorrelationId(input)
    const data = { ...(input.data ?? {}) }
    data.correlation_id = correlationId

    try {
      if (this.isAlreadyVerifiedAuthorizationData(data)) {
        const currentStatus = readText(data.razorpay_payment_status)
        increment("razorpay.authorize.success")
        return {
          status: mapPaymentStatus(readText(data.payment_status) || currentStatus),
          data,
        }
      }

      this.ensureConfigured(correlationId)
      const payload = this.resolveAuthorizePayload({
        data,
        correlationId,
      })

      this.verifyCheckoutSignature({
        orderId: payload.orderId,
        paymentId: payload.paymentId,
        signature: payload.signature,
        correlationId,
        sessionId: readText(data.session_id),
      })

      data.razorpay_order_id = payload.orderId
      data.razorpay_payment_id = payload.paymentId
      data.verified_at = readText(data.verified_at) || new Date().toISOString()
      data.authorized_at = readText(data.authorized_at) || new Date().toISOString()
      data.razorpay_signature_verified = true
      const transition = this.transitionProviderStatus({
        data,
        next_status: "authorized",
        correlationId,
      })
      delete data.razorpay_signature
      increment("razorpay.authorize.success")

      return {
        status: mapInternalStatusToPaymentSessionStatus(
          transition.next_internal_status
        ),
        data,
      }
    } catch (error) {
      increment("razorpay.authorize.fail")
      throw error
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const correlationId = this.resolveCorrelationId(input)
    const data = { ...(input.data ?? {}) }
    data.correlation_id = correlationId

    const currentStatus = readText(data.razorpay_payment_status).toLowerCase()
    if (currentStatus === "captured") {
      return { data }
    }

    const paymentId = readText(data.razorpay_payment_id)
    const amount = toMinorAmount(data.amount)
    const currencyCode = this.ensureInrCurrency(data.currency_code, correlationId)

    if (!paymentId) {
      if (this.paymentsMode === "test") {
        data.razorpay_payment_id = randomId("pay_test")
        this.transitionProviderStatus({
          data,
          next_status: "captured",
          correlationId,
          onInvalid: "noop",
        })
        data.captured_at = new Date().toISOString()
        return { data }
      }

      this.throwProviderError({
        code: "RAZORPAY_PAYMENT_ID_REQUIRED",
        message: "Cannot capture payment without a Razorpay payment id.",
        correlationId,
        httpStatus: 400,
      })
    }

    const captured = await this.requestWithRetry<RazorpayPaymentResponse>({
      path: `/v1/payments/${paymentId}/capture`,
      method: "POST",
      correlationId,
      body: {
        amount,
        currency: currencyCode,
      },
    })
    this.mergePaymentData(data, captured, correlationId)
    this.transitionProviderStatus({
      data,
      next_status: "captured",
      correlationId,
    })
    data.captured_at = readText(data.captured_at) || new Date().toISOString()

    return { data }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const correlationId = this.resolveCorrelationId(input)
    const data = { ...(input.data ?? {}) }
    data.correlation_id = correlationId

    this.log("info", "RAZORPAY_REFUND_CALLED", correlationId, {
      session_id: readText(data.session_id) || null,
      razorpay_order_id: readText(data.razorpay_order_id) || null,
      razorpay_payment_id: readText(data.razorpay_payment_id) || null,
      razorpay_payment_status: readText(data.razorpay_payment_status).toLowerCase() || null,
      amount: toMinorAmount(input.amount) || null,
    })

    const currentStatus = readText(data.razorpay_payment_status).toLowerCase()
    if (currentStatus === "refunded" && readText(data.razorpay_refund_id)) {
      return { data }
    }

    const paymentId = readText(data.razorpay_payment_id)
    const amount = toMinorAmount(input.amount || data.amount)

    if (amount <= 0) {
      this.throwProviderError({
        code: "RAZORPAY_INVALID_AMOUNT",
        message: "Refund amount must be a positive integer in paise.",
        correlationId,
        httpStatus: 400,
      })
    }

    if (!paymentId) {
      if (this.paymentsMode === "test") {
        data.razorpay_refund_id = randomId("rfnd_test")
        data.refunded_at = readText(data.refunded_at) || new Date().toISOString()
        this.transitionProviderStatus({
          data,
          next_status: "refunded",
          correlationId,
          onInvalid: "noop",
        })
        return { data }
      }

      this.throwProviderError({
        code: "RAZORPAY_PAYMENT_ID_REQUIRED",
        message: "Cannot refund payment without a Razorpay payment id.",
        correlationId,
        httpStatus: 400,
      })
    }

    const refunded = await this.requestWithRetry<RazorpayRefundResponse>({
      path: `/v1/payments/${paymentId}/refund`,
      method: "POST",
      correlationId,
      body: {
        amount,
      },
    })

    const refundId = readText(refunded.id)
    if (refundId) {
      data.razorpay_refund_id = refundId
    }

    data.refunded_at = readText(data.refunded_at) || new Date().toISOString()
    this.transitionProviderStatus({
      data,
      next_status: "refunded",
      correlationId,
      onInvalid: "noop",
    })

    return { data }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const correlationId = this.resolveCorrelationId(input)
    const data = { ...(input.data ?? {}) }
    data.correlation_id = correlationId

    const paymentId = readText(data.razorpay_payment_id)
    if (paymentId) {
      const payment = await this.retrieveRazorpayPayment(paymentId, correlationId)
      this.mergePaymentData(data, payment, correlationId)
    }

    const status = mapPaymentStatus(
      readText(data.payment_status) || readText(data.razorpay_payment_status)
    )
    return {
      status,
      data,
    }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const correlationId = this.resolveCorrelationId(input)
    const data = { ...(input.data ?? {}) }
    data.correlation_id = correlationId

    const paymentId = readText(data.razorpay_payment_id)
    if (paymentId) {
      const payment = await this.retrieveRazorpayPayment(paymentId, correlationId)
      this.mergePaymentData(data, payment, correlationId)
    }

    return {
      data,
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const correlationId = this.resolveCorrelationId(input)
    const data = { ...(input.data ?? {}) }
    const nextCurrency = this.ensureInrCurrency(input.currency_code, correlationId)
    const nextAmount = toMinorAmount(input.amount)
    const existingAmount = toMinorAmount(data.amount)

    if (existingAmount > 0 && existingAmount !== nextAmount) {
      this.throwProviderError({
        code: "RAZORPAY_AMOUNT_IMMUTABLE",
        message:
          "Razorpay order amount changed for the same payment session. Create a new session.",
        correlationId,
        httpStatus: 409,
        details: {
          previous_amount: existingAmount,
          next_amount: nextAmount,
          session_id: readText(data.session_id),
        },
      })
    }

    data.amount = nextAmount
    data.currency_code = nextCurrency
    data.correlation_id = correlationId

    if (!readText(data.razorpay_order_id) && readText(data.session_id)) {
      data.razorpay_order_id = await this.createOrGetOrderForSession({
        sessionId: readText(data.session_id),
        amount: nextAmount,
        currencyCode: nextCurrency,
        correlationId,
      })
    }

    const presentationData = getPaymentPresentationData(
      "pp_razorpay_razorpay",
      data,
      {
        customer: input.context?.customer ?? null,
      }
    )
    if (presentationData) {
      data.presentation_data = presentationData
    }

    return {
      data,
      status: mapPaymentStatus(
        readText(data.payment_status) || readText(data.razorpay_payment_status)
      ),
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return this.cancelPayment(input)
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const correlationId = this.resolveCorrelationId(input)
    const data = { ...(input.data ?? {}) }
    data.correlation_id = correlationId

    const currentStatus = readText(data.razorpay_payment_status).toLowerCase()
    this.log("info", "RAZORPAY_CANCEL_CALLED", correlationId, {
      session_id: readText(data.session_id) || null,
      razorpay_order_id: readText(data.razorpay_order_id) || null,
      razorpay_payment_id: readText(data.razorpay_payment_id) || null,
      razorpay_payment_status: currentStatus || null,
    })

    if (this.isPaidStatusForCancel(currentStatus)) {
      this.throwProviderError({
        code: "CANNOT_CANCEL_PAID_PAYMENT",
        message: "Cannot cancel a paid Razorpay payment.",
        correlationId,
        httpStatus: 409,
        details: {
          razorpay_payment_status: currentStatus,
          razorpay_payment_id: readText(data.razorpay_payment_id) || null,
        },
      })
    }

    if (currentStatus === "canceled" || currentStatus === "cancelled") {
      return { data }
    }

    this.transitionProviderStatus({
      data,
      next_status: "canceled",
      correlationId,
    })
    data.canceled_at = readText(data.canceled_at) || new Date().toISOString()
    return { data }
  }

  private resolveWebhookProviderDefinition(
    correlationId: string
  ): PaymentWebhookProviderDefinition {
    const definition = resolveWebhookProviderDefinition("razorpay")
    if (definition) {
      return definition
    }

    this.throwProviderError({
      code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
      message: "Razorpay webhook provider definition is unavailable.",
      correlationId,
      httpStatus: 503,
    })
  }

  private verifyWebhookSignature(input: {
    rawBody: Buffer
    headers: Record<string, string | string[] | undefined>
    correlationId: string
  }): boolean {
    const providerDefinition = this.resolveWebhookProviderDefinition(
      input.correlationId
    )
    const verification = providerDefinition.verifySignature({
      raw_body: input.rawBody,
      headers: input.headers,
      env: {
        ...process.env,
        RAZORPAY_WEBHOOK_SECRET: this.webhookSecret,
      },
    })

    if (!verification.verified) {
      const reason = toWebhookVerificationReason(verification)
      if (this.allowUnverifiedWebhooks) {
        logPaymentProviderEvent(
          "PAYMENT_WEBHOOK_UNVERIFIED_ALLOWED",
          {
            provider: "razorpay",
            correlation_id: input.correlationId,
            details: {
              reason,
            },
          },
          { level: "warn", scopeOrLogger: this.logger }
        )
        return false
      }

      if (reason === "missing_webhook_secret") {
        this.throwProviderError({
          code: PaymentErrorCode.RAZORPAY_WEBHOOK_SECRET_MISSING,
          message:
            readText(verification.message) || "Razorpay webhook secret is missing.",
          correlationId: input.correlationId,
          httpStatus: 500,
        })
      }

      if (reason === "missing_signature_header") {
        this.throwProviderError({
          code: PaymentErrorCode.RAZORPAY_SIGNATURE_MISSING,
          message:
            readText(verification.message) ||
            "Missing Razorpay webhook signature header.",
          correlationId: input.correlationId,
          httpStatus: 401,
        })
      }

      this.throwProviderError({
        code: PaymentErrorCode.RAZORPAY_SIGNATURE_INVALID,
        message:
          readText(verification.message) || "Invalid Razorpay webhook signature.",
        correlationId: input.correlationId,
        httpStatus: 401,
      })
    }

    logPaymentProviderEvent(
      "PAYMENT_WEBHOOK_VERIFIED",
      {
        provider: "razorpay",
        correlation_id: input.correlationId,
      },
      { scopeOrLogger: this.logger }
    )
    return true
  }

  private async markWebhookProcessed(input: {
    eventId: string
    eventType: string
    providerPaymentId?: string
    correlationId: string
  }): Promise<boolean> {
    await this.ensureTables(input.correlationId)
    const result = await this.webhookEventRepository!.markProcessed({
      id: input.eventId,
      event_type: input.eventType,
      provider_payment_id: input.providerPaymentId,
    })

    return result.processed
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const payloadData = (payload.data ?? {}) as Record<string, unknown>
    const correlationId =
      readText(payloadData.correlation_id) || crypto.randomUUID()
    const fallbackEventId = resolveHeader(
      (payload.headers ?? {}) as Record<string, string | string[] | undefined>,
      "x-razorpay-event-id"
    )
    const fallbackEventType = readText((payloadData as RazorpayWebhookEvent)?.event).toLowerCase()
    try {
      const rawBody = toBuffer(payload.rawData)
      const headers = (payload.headers ?? {}) as Record<
        string,
        string | string[] | undefined
      >

      const verified = this.verifyWebhookSignature({
        rawBody,
        headers,
        correlationId,
      })
      logPaymentProviderEvent(
        verified ? "PAYMENT_WEBHOOK_PATH_CONTINUE_VERIFIED" : "PAYMENT_WEBHOOK_PATH_CONTINUE_UNVERIFIED",
        {
          provider: "razorpay",
          correlation_id: correlationId,
        },
        { scopeOrLogger: this.logger }
      )

      const event = payload.data as RazorpayWebhookEvent
      const eventType = readText(event?.event).toLowerCase()
      const paymentEntity = event?.payload?.payment?.entity ?? {}
      const action = mapWebhookAction(eventType)
      if (action === PaymentActions.NOT_SUPPORTED) {
        logWebhookEvent(
          {
            provider: "razorpay",
            event_type: eventType || "unknown",
            event_id: fallbackEventId || "unknown",
            matched: false,
            deduped: false,
            success: true,
            correlation_id: correlationId,
          },
          {
            scopeOrLogger: this.logger,
          }
        )
        this.log("info", "RAZORPAY_WEBHOOK_OK", correlationId, {
          event_type: eventType || null,
          action,
          reason: "not_supported",
        })
        increment("razorpay.webhook.success")
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      const amount = toMinorAmount(paymentEntity.amount)
      let sessionId = readText(paymentEntity.notes?.session_id)
      if (!sessionId) {
        const orderId = readText(paymentEntity.order_id)
        if (orderId) {
          sessionId = await this.getSessionOrderIdByOrderId(orderId, correlationId)
        }
      }

      if (!sessionId) {
        logWebhookEvent(
          {
            provider: "razorpay",
            event_type: eventType || "unknown",
            event_id: fallbackEventId || "unknown",
            matched: false,
            deduped: false,
            success: true,
            correlation_id: correlationId,
          },
          {
            scopeOrLogger: this.logger,
          }
        )
        this.log("warn", "Razorpay webhook ignored due to missing session id.", correlationId, {
          event_type: eventType,
          payment_id: readText(paymentEntity.id),
        })
        this.log("info", "RAZORPAY_WEBHOOK_OK", correlationId, {
          event_id: fallbackEventId || null,
          event_type: eventType || null,
          action: PaymentActions.NOT_SUPPORTED,
          reason: "missing_session",
        })
        increment("razorpay.webhook.success")
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      const providerDefinition = this.resolveWebhookProviderDefinition(
        correlationId
      )
      const mappedBody = {
        ...(event as Record<string, unknown>),
        payload: {
          ...((event.payload ?? {}) as Record<string, unknown>),
          payment: {
            ...((event.payload?.payment ?? {}) as Record<string, unknown>),
            entity: {
              ...(paymentEntity as Record<string, unknown>),
              notes: {
                ...((paymentEntity.notes ?? {}) as Record<string, unknown>),
                session_id: sessionId,
              },
            },
          },
        },
      }
      const mappedEvent = providerDefinition.mapEvent({
        provider: providerDefinition.id,
        body: mappedBody,
        raw_body: rawBody,
        headers,
      })
      const resolvedEventId = readText(mappedEvent.payment_event.event_id)
      const resolvedEventType = readText(mappedEvent.payment_event.event_type)
      const providerPaymentId =
        readText(mappedEvent.payment_event.provider_payment_id) ||
        readText(paymentEntity.id)

      const inserted = await this.markWebhookProcessed({
        eventId: resolvedEventId,
        eventType: resolvedEventType || eventType,
        providerPaymentId,
        correlationId,
      })
      if (!inserted) {
        logWebhookEvent(
          {
            provider: "razorpay",
            event_type: resolvedEventType || eventType || "unknown",
            event_id: resolvedEventId || "unknown",
            matched: false,
            deduped: true,
            success: true,
            correlation_id: correlationId,
          },
          {
            scopeOrLogger: this.logger,
          }
        )
        this.log("info", "WEBHOOK_DEDUP_HIT", correlationId, {
          event_id: resolvedEventId || null,
          event_type: resolvedEventType || eventType || null,
          provider_payment_id: providerPaymentId || null,
        })
        this.log("info", "RAZORPAY_WEBHOOK_OK", correlationId, {
          event_id: resolvedEventId || null,
          event_type: resolvedEventType || eventType || null,
          action: PaymentActions.NOT_SUPPORTED,
          reason: "dedup_hit",
        })
        increment("razorpay.webhook.success")
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      if (amount <= 0) {
        logWebhookEvent(
          {
            provider: "razorpay",
            event_type: resolvedEventType || eventType || "unknown",
            event_id: resolvedEventId || "unknown",
            matched: true,
            deduped: false,
            success: true,
            correlation_id: correlationId,
          },
          {
            scopeOrLogger: this.logger,
          }
        )
        this.log("warn", "Razorpay webhook ignored due to missing amount.", correlationId, {
          event_type: resolvedEventType || eventType,
          session_id: sessionId,
        })
        this.log("info", "RAZORPAY_WEBHOOK_OK", correlationId, {
          event_id: resolvedEventId || null,
          event_type: resolvedEventType || eventType || null,
          action: PaymentActions.NOT_SUPPORTED,
          reason: "missing_amount",
        })
        increment("razorpay.webhook.success")
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      this.log("info", "Processed Razorpay webhook.", correlationId, {
        event_id: resolvedEventId || null,
        event_type: resolvedEventType || eventType || null,
        session_id: sessionId,
        action,
      })
      this.log("info", "RAZORPAY_WEBHOOK_OK", correlationId, {
        event_id: resolvedEventId || null,
        event_type: resolvedEventType || eventType || null,
        session_id: sessionId,
        action,
      })
      logWebhookEvent(
        {
          provider: "razorpay",
          event_type: resolvedEventType || eventType || "unknown",
          event_id: resolvedEventId || "unknown",
          matched: true,
          deduped: false,
          success: true,
          correlation_id: correlationId,
        },
        {
          scopeOrLogger: this.logger,
        }
      )
      increment("razorpay.webhook.success")

      return {
        action,
        data: {
          session_id: sessionId,
          amount,
        },
      }
    } catch (error) {
      this.log("error", "RAZORPAY_WEBHOOK_FAIL", correlationId, {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected Razorpay webhook processing error.",
      })
      logWebhookEvent(
        {
          provider: "razorpay",
          event_type: fallbackEventType || "unknown",
          event_id: fallbackEventId || "unknown",
          matched: false,
          deduped: false,
          success: false,
          correlation_id: correlationId,
        },
        {
          level: "error",
          scopeOrLogger: this.logger,
        }
      )
      increment("razorpay.webhook.fail")
      throw error
    }
  }
}
