import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils"
import { OBSERVABILITY_MODULE } from "./src/modules/observability"
import {
  RazorpayConfigError,
  validateRazorpayConfig,
} from "./src/modules/payment-razorpay/config"
import {
  RAZORPAY_PROVIDER_ID,
  RazorpayProviderRegistrationError,
  assertRazorpayProviderRegistered,
} from "./src/modules/payment-razorpay/provider-registration"

// Only load .env in development (not in Railway/Render)

loadEnv(process.env.NODE_ENV || "development", process.cwd())

function readEnvText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readEnvBool(value: unknown): boolean {
  const normalized = readEnvText(value).toLowerCase()
  return ["true", "1", "yes", "on"].includes(normalized)
}

class PaymentProviderDefaultError extends Error {
  code: string
  reason: string

  constructor(reason: string) {
    super("PAYMENT_PROVIDER_DEFAULT_INVALID")
    this.name = "PaymentProviderDefaultError"
    this.code = "PAYMENT_PROVIDER_DEFAULT_INVALID"
    this.reason = reason
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function expandProviderIdCandidates(value: string): string[] {
  const normalized = readEnvText(value).toLowerCase()
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

function assertDefaultPaymentProviderRegistered(input: {
  providers: Array<Record<string, unknown>>
  defaultProviderId: unknown
}): void {
  const configured = readEnvText(input.defaultProviderId).toLowerCase()
  if (!configured) {
    return
  }

  const registered = dedupe(
    input.providers
      .map((provider) => readEnvText(provider.id).toLowerCase())
      .filter(Boolean)
  )
  const configuredCandidates = expandProviderIdCandidates(configured)
  const matches = configuredCandidates.some((candidate) =>
    registered.includes(candidate)
  )

  if (matches) {
    return
  }

  throw new PaymentProviderDefaultError(
    `PAYMENT_PROVIDER_DEFAULT '${configured}' is not registered. Registered providers: ${
      registered.join(", ") || "<none>"
    }.`
  )
}

const backendUrl = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"

// Redis module config (production only — optional for dev)
const redisUrl = process.env.REDIS_URL
const razorpayRequested =
  readEnvBool(process.env.ENABLE_RAZORPAY) ||
  Boolean(readEnvText(process.env.RAZORPAY_KEY_ID)) ||
  Boolean(readEnvText(process.env.RAZORPAY_KEY_SECRET))

let razorpayConfig: ReturnType<typeof validateRazorpayConfig> | undefined
if (razorpayRequested) {
  try {
    razorpayConfig = validateRazorpayConfig(process.env)
  } catch (error) {
    const reason =
      error instanceof RazorpayConfigError ? error.code : "RAZORPAY_CONFIG_UNKNOWN"
    const message =
      error instanceof RazorpayConfigError ? error.reason : "Unknown Razorpay config error."
    // Keep startup logging structured without leaking secrets.
    console.error({
      event: "RAZORPAY_CONFIG_INVALID",
      reason,
      message,
    })

    throw error
  }
}

const modules: Record<string, any> = {}
const paymentProviders: Array<Record<string, unknown>> = [
  {
    resolve: "./src/modules/payment-cod",
    id: "cod",
  },
]

if (razorpayConfig) {
  paymentProviders.push({
    resolve: "./src/modules/payment-razorpay",
    id: RAZORPAY_PROVIDER_ID,
    options: {
      key_id: razorpayConfig.keyId,
      key_secret: razorpayConfig.keySecret,
      webhook_secret: razorpayConfig.webhookSecret ?? "",
      payments_mode: razorpayConfig.mode,
      test_auto_authorize: readEnvBool(process.env.RAZORPAY_TEST_AUTO_AUTHORIZE),
      allow_unverified_webhooks: readEnvBool(
        process.env.PAYMENTS_ALLOW_UNVERIFIED_WEBHOOKS
      ),
      api_base_url: readEnvText(process.env.RAZORPAY_API_BASE_URL),
    },
  })

  try {
    assertRazorpayProviderRegistered(paymentProviders)
  } catch (error) {
    const reason =
      error instanceof RazorpayProviderRegistrationError
        ? error.reason
        : "Unknown Razorpay provider registration error."

    console.error({
      event: "RAZORPAY_PROVIDER_REGISTRATION_FAILED",
      reason,
    })

    throw error
  }
}

try {
  assertDefaultPaymentProviderRegistered({
    providers: paymentProviders,
    defaultProviderId: process.env.PAYMENT_PROVIDER_DEFAULT,
  })
} catch (error) {
  const reason =
    error instanceof PaymentProviderDefaultError
      ? error.reason
      : "Unknown payment provider default registration error."
  console.error({
    event: "PAYMENT_PROVIDER_DEFAULT_INVALID",
    reason,
  })
  throw error
}

modules[OBSERVABILITY_MODULE] = {
  resolve: "./src/modules/observability",
}

modules[Modules.PAYMENT] = {
  resolve: "@medusajs/payment",
  options: {
    providers: paymentProviders,
  },
}

// Resend email notification provider
if (process.env.RESEND_API_KEY) {
  modules[Modules.NOTIFICATION] = {
    resolve: "@medusajs/medusa/notification",
    options: {
      providers: [
        {
          resolve: "./src/modules/resend",
          id: "resend",
          options: {
            channels: ["email"],
            api_key: process.env.RESEND_API_KEY,
            from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
          },
        },
      ],
    },
  }
}

// Cloudflare R2 file storage (only if R2 is configured)
if (process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID) {
  modules[Modules.FILE] = {
    resolve: "@medusajs/file",
    options: {
      providers: [
        {
          resolve: "@medusajs/file-s3",
          id: "s3",
          options: {
            endpoint: process.env.R2_ENDPOINT,
            bucket: process.env.R2_BUCKET,
            region: process.env.R2_REGION || "auto",
            access_key_id: process.env.R2_ACCESS_KEY_ID,
            secret_access_key: process.env.R2_SECRET_ACCESS_KEY,

            file_url: process.env.R2_PUBLIC_URL,
            s3_url: process.env.R2_PUBLIC_URL,
            public_url: process.env.R2_PUBLIC_URL,

            additional_client_config: {
              forcePathStyle: true,
            },
          },
        },
      ],
    },
  }
}

// Use Redis for event bus and caching in production
if (redisUrl) {
  modules[Modules.EVENT_BUS] = {
    resolve: "@medusajs/event-bus-redis",
    options: {
      redisUrl,
    },
  }

  modules[Modules.CACHE] = {
    resolve: "@medusajs/cache-redis",
    options: {
      redisUrl,
    },
  }
}

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseLogging: process.env.NODE_ENV === "development",
    redisUrl,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:8000",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },

  admin: {
    backendUrl,
    disable: false,
  },

  modules,
})
