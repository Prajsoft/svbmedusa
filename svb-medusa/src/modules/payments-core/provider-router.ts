import crypto from "crypto"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { logEvent } from "../logging/log-event"
import {
  PaymentErrorCode,
  PaymentProviderError,
  type PaymentErrorCode as PaymentErrorCodeType,
} from "./contracts"

type QueryGraphLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

type ScopeLike = {
  resolve?: (key: string) => unknown
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readBool(value: unknown, fallback = true): boolean {
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

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function expandProviderIdCandidates(value: string): string[] {
  const normalized = readText(value).toLowerCase()
  if (!normalized) {
    return []
  }

  if (!normalized.startsWith("pp_")) {
    return [normalized]
  }

  const body = normalized.slice(3)
  const segments = body.split("_").filter(Boolean)
  const first = segments[0] || ""
  const last = segments[segments.length - 1] || ""

  return dedupe([normalized, body, first, last])
}

function resolveQuery(scope?: ScopeLike | null): QueryGraphLike | null {
  if (!scope || typeof scope.resolve !== "function") {
    return null
  }

  try {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraphLike
    return query && typeof query.graph === "function" ? query : null
  } catch {
    return null
  }
}

function toCorrelationId(value?: string): string {
  return readText(value) || crypto.randomUUID()
}

function buildProviderUnavailableError(input: {
  code?: PaymentErrorCodeType
  message: string
  correlation_id: string
  details?: Record<string, unknown>
  http_status?: number
}): PaymentProviderError {
  return new PaymentProviderError({
    code: input.code ?? PaymentErrorCode.PROVIDER_UNAVAILABLE,
    message: input.message,
    correlation_id: input.correlation_id,
    http_status: input.http_status ?? 503,
    details: input.details ?? {},
  })
}

export type ProviderSelection<TProvider> = {
  provider_id: string
  provider: TProvider
  correlation_id: string
  payment_session_id?: string
}

type RouterOptions<TProvider> = {
  providers: Record<string, TProvider>
  env?: NodeJS.ProcessEnv
  scopeOrLogger?: unknown
  query?: QueryGraphLike
}

export class PaymentProviderRouter<TProvider = unknown> {
  private readonly providers: Record<string, TProvider>
  private readonly env: NodeJS.ProcessEnv
  private readonly scopeOrLogger?: unknown
  private readonly query: QueryGraphLike | null

  constructor(options: RouterOptions<TProvider>) {
    this.providers = options.providers ?? {}
    this.env = options.env ?? process.env
    this.scopeOrLogger = options.scopeOrLogger
    this.query =
      options.query ??
      resolveQuery(
        options.scopeOrLogger &&
          typeof options.scopeOrLogger === "object" &&
          "resolve" in (options.scopeOrLogger as Record<string, unknown>)
          ? (options.scopeOrLogger as ScopeLike)
          : null
      )
  }

  getDefaultProvider(input: {
    correlation_id?: string
    payment_session_id?: string
  } = {}): ProviderSelection<TProvider> {
    const correlationId = toCorrelationId(input.correlation_id)
    this.assertPaymentsEnabled(correlationId)

    const configured = readText(this.env.PAYMENT_PROVIDER_DEFAULT).toLowerCase()
    const defaultProviderId = configured || "cod"

    return this.selectProvider(defaultProviderId, {
      correlation_id: correlationId,
      payment_session_id: input.payment_session_id,
    })
  }

  getProviderById(
    providerId: string,
    input: {
      correlation_id?: string
      payment_session_id?: string
    } = {}
  ): ProviderSelection<TProvider> {
    const correlationId = toCorrelationId(input.correlation_id)
    this.assertPaymentsEnabled(correlationId)

    return this.selectProvider(providerId, {
      correlation_id: correlationId,
      payment_session_id: input.payment_session_id,
    })
  }

  async getProviderForPaymentSession(input: {
    payment_session_id: string
    correlation_id?: string
  }): Promise<ProviderSelection<TProvider>> {
    const paymentSessionId = readText(input.payment_session_id)
    const correlationId = toCorrelationId(input.correlation_id)

    this.assertPaymentsEnabled(correlationId)

    if (!paymentSessionId) {
      throw buildProviderUnavailableError({
        code: PaymentErrorCode.VALIDATION_ERROR,
        message: "payment_session_id is required for provider routing.",
        correlation_id: correlationId,
        http_status: 400,
      })
    }

    if (!this.query) {
      throw buildProviderUnavailableError({
        code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
        message: "Payment provider router query dependency is not available.",
        correlation_id: correlationId,
        details: {
          payment_session_id: paymentSessionId,
        },
      })
    }

    const response = await this.query.graph({
      entity: "payment_session",
      fields: ["id", "provider_id"],
      filters: {
        id: paymentSessionId,
      },
    })

    const row =
      Array.isArray(response?.data) && response?.data[0]
        ? (response.data[0] as Record<string, unknown>)
        : null
    const storedProviderId = readText(row?.provider_id)

    if (!storedProviderId) {
      throw buildProviderUnavailableError({
        code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
        message: "Unable to resolve payment provider from stored payment session.",
        correlation_id: correlationId,
        details: {
          payment_session_id: paymentSessionId,
        },
      })
    }

    return this.selectProvider(storedProviderId, {
      correlation_id: correlationId,
      payment_session_id: paymentSessionId,
    })
  }

  private assertPaymentsEnabled(correlationId: string): void {
    const enabled = readBool(this.env.PAYMENTS_ENABLED, true)
    if (enabled) {
      return
    }

    throw buildProviderUnavailableError({
      code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
      message: "Payments are disabled by PAYMENTS_ENABLED=false.",
      correlation_id: correlationId,
      details: {
        payments_enabled: false,
      },
    })
  }

  private selectProvider(
    providerId: string,
    input: {
      correlation_id: string
      payment_session_id?: string
    }
  ): ProviderSelection<TProvider> {
    const normalizedMap = this.providers
    const candidates = expandProviderIdCandidates(providerId)

    for (const candidate of candidates) {
      const provider = normalizedMap[candidate]
      if (!provider) {
        continue
      }

      const selection: ProviderSelection<TProvider> = {
        provider_id: candidate,
        provider,
        correlation_id: input.correlation_id,
      }
      if (input.payment_session_id) {
        selection.payment_session_id = input.payment_session_id
      }

      logEvent(
        "PAYMENT_PROVIDER_SELECTED",
        {
          provider: candidate,
          payment_session_id: input.payment_session_id ?? null,
        },
        input.correlation_id,
        {
          scopeOrLogger: this.scopeOrLogger,
        }
      )

      return selection
    }

    throw buildProviderUnavailableError({
      code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
      message: `Payment provider not available for id: ${readText(providerId) || "<empty>"}`,
      correlation_id: input.correlation_id,
      details: {
        provider_id: readText(providerId),
      },
    })
  }
}
