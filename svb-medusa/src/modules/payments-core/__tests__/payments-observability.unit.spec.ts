import {
  __resetMetricsForTests,
  getMetricsSnapshot,
} from "../../observability/metrics"
import {
  logProviderCall,
  logWebhookEvent,
  logReconcileRun,
} from "../../../../payments/observability"

function parseSerializedLogs(mockFn: jest.Mock): Array<Record<string, unknown>> {
  return mockFn.mock.calls
    .map((call) => call?.[0])
    .filter((line): line is string => typeof line === "string")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function collectObjectKeys(value: unknown, keys: string[] = []): string[] {
  if (!value || typeof value !== "object") {
    return keys
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.push(String(key))
    collectObjectKeys(nested, keys)
  }

  return keys
}

describe("payments observability helpers", () => {
  afterEach(() => {
    jest.resetAllMocks()
    __resetMetricsForTests()
  })

  it("logs standardized provider/webhook/reconcile events with required fields", () => {
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
    }

    logProviderCall(
      {
        provider: "razorpay",
        method: "orders.create",
        duration_ms: 145,
        success: true,
        correlation_id: "f8c13f88-7874-41ba-b8d2-17f100b8f3db",
        payment_session_id: "ps_001",
      },
      {
        scopeOrLogger: logger,
      }
    )
    logWebhookEvent(
      {
        provider: "razorpay",
        event_type: "payment.captured",
        event_id: "evt_001",
        matched: true,
        deduped: false,
        success: true,
        correlation_id: "f8c13f88-7874-41ba-b8d2-17f100b8f3db",
      },
      {
        scopeOrLogger: logger,
      }
    )
    logReconcileRun(
      {
        provider: "razorpay",
        checked_count: 9,
        updated_count: 4,
        success: true,
        correlation_id: "f8c13f88-7874-41ba-b8d2-17f100b8f3db",
      },
      {
        scopeOrLogger: logger,
      }
    )

    const infoLogs = parseSerializedLogs(logger.info as jest.Mock)
    const snapshotView = infoLogs.map((entry) => ({
      message: entry.message,
      correlation_id: entry.correlation_id,
      meta: entry.meta,
    }))

    expect(snapshotView).toMatchInlineSnapshot(`
      [
        {
          "correlation_id": "f8c13f88-7874-41ba-b8d2-17f100b8f3db",
          "message": "PAYMENT_PROVIDER_CALL",
          "meta": {
            "duration_ms": 145,
            "error_code": null,
            "method": "orders.create",
            "payment_id": null,
            "payment_session_id": "ps_001",
            "provider": "razorpay",
            "success": true,
          },
        },
        {
          "correlation_id": "f8c13f88-7874-41ba-b8d2-17f100b8f3db",
          "message": "PAYMENT_WEBHOOK_EVENT",
          "meta": {
            "deduped": false,
            "event_id": "evt_001",
            "event_type": "payment.captured",
            "matched": true,
            "provider": "razorpay",
            "success": true,
          },
        },
        {
          "correlation_id": "f8c13f88-7874-41ba-b8d2-17f100b8f3db",
          "message": "PAYMENT_RECONCILE_RUN",
          "meta": {
            "checked_count": 9,
            "provider": "razorpay",
            "success": true,
            "updated_count": 4,
          },
        },
      ]
    `)

    const metrics = getMetricsSnapshot()
    const counterNames = metrics.counters.map((entry) => entry.name)
    const timerNames = metrics.timers.map((entry) => entry.name)

    expect(counterNames).toContain("payments.provider.call.total")
    expect(counterNames).toContain("payments.webhook.event.total")
    expect(counterNames).toContain("payments.reconcile.run.total")
    expect(timerNames).toContain("payments.provider.call.duration_ms")
  })

  it("does not log PII or secret keys in observability payloads", () => {
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
    }

    logProviderCall(
      {
        provider: "razorpay",
        method: "payments.fetch",
        duration_ms: 22,
        success: false,
        error_code: "RAZORPAY_RATE_LIMIT",
        correlation_id: "2ddf3b77-7412-48e6-b784-502f5b534cc6",
      } as any,
      {
        scopeOrLogger: logger,
      }
    )
    logWebhookEvent(
      {
        provider: "razorpay",
        event_type: "payment.failed",
        event_id: "evt_unsafe_1",
        matched: false,
        deduped: false,
        success: false,
        correlation_id: "2ddf3b77-7412-48e6-b784-502f5b534cc6",
        customer_email: "private@example.com",
        phone: "9999999999",
        authorization: "Bearer token",
      } as any,
      {
        level: "error",
        scopeOrLogger: logger,
      }
    )
    logReconcileRun(
      {
        provider: "razorpay",
        checked_count: 3,
        updated_count: 0,
        success: false,
        correlation_id: "2ddf3b77-7412-48e6-b784-502f5b534cc6",
        email: "private@example.com",
      } as any,
      {
        level: "error",
        scopeOrLogger: logger,
      }
    )

    const parsed = [
      ...parseSerializedLogs(logger.info as jest.Mock),
      ...parseSerializedLogs(logger.error as jest.Mock),
    ]
    const allKeys = parsed.flatMap((entry) => collectObjectKeys(entry.meta))
    const piiOrSecretPattern =
      /(email|phone|mobile|contact|customer|name|address|authorization|secret|token|password|api[_-]?key)/i

    expect(allKeys.some((key) => piiOrSecretPattern.test(key))).toBe(false)
  })
})

