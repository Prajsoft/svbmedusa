import {
  ContainerRegistrationKeys,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { PaymentErrorCode } from "../contracts"
import { runStuckPaymentReconciliation } from "../reconciliation"

function makeContainer(input: {
  rows?: Array<Record<string, unknown>>
  queryError?: Error
  providerStatusResult?: {
    status?: string
    data?: Record<string, unknown>
  }
  providerStatusError?: Error
  providerStatusImpl?: (
    providerId: string,
    payload: { data: Record<string, unknown> }
  ) => Promise<{ status?: string; data?: Record<string, unknown> }>
}) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }

  const getStatus = input.providerStatusImpl
    ? jest.fn(input.providerStatusImpl)
    : input.providerStatusError
      ? jest.fn(async () => {
          throw input.providerStatusError
        })
      : jest.fn(async () => ({
          status: input.providerStatusResult?.status ?? "pending",
          data: input.providerStatusResult?.data ?? {},
        }))

  const query = {
    graph: input.queryError
      ? jest.fn(async () => {
          throw input.queryError
        })
      : jest.fn(async () => ({
          data: input.rows ?? [],
        })),
  }

  const paymentModule = {
    updatePaymentSession: jest.fn(async () => undefined),
    paymentProviderService_: {
      getStatus,
    },
  }

  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) {
        return query
      }
      if (key === Modules.PAYMENT) {
        return paymentModule
      }
      if (key === ContainerRegistrationKeys.LOGGER || key === "logger") {
        return logger
      }
      return undefined
    },
  } as any

  return {
    container,
    query,
    paymentModule,
    getStatus,
    logger,
  }
}

function parseSerializedLogs(mockFn: jest.Mock): Array<Record<string, unknown>> {
  return mockFn.mock.calls
    .map((call) => call?.[0])
    .filter((line): line is string => typeof line === "string")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("stuck payment reconciliation", () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it("reconciles stale pending session to captured from provider status", async () => {
    const now = Date.parse("2026-02-20T12:00:00.000Z")
    const updatedAt = new Date(now - 60 * 60 * 1000).toISOString()
    const { container, paymentModule, getStatus, logger } = makeContainer({
      rows: [
        {
          id: "payses_1",
          provider_id: "pp_razorpay_razorpay",
          status: "pending",
          amount: 1499,
          currency_code: "INR",
          updated_at: updatedAt,
          data: {
            correlation_id: "corr_recon_1",
          },
        },
      ],
      providerStatusResult: {
        status: "captured",
        data: {
          razorpay_payment_status: "captured",
          razorpay_payment_id: "pay_test_1",
        },
      },
    })

    const result = await runStuckPaymentReconciliation(container, {
      now_ms: now,
      stuck_minutes: 30,
    })

    expect(result).toEqual({
      scanned: 1,
      candidates: 1,
      reconciled: 1,
      skipped: 0,
    })
    expect(getStatus).toHaveBeenCalledWith("pp_razorpay_razorpay", {
      data: expect.objectContaining({
        correlation_id: "corr_recon_1",
      }),
    })
    expect(paymentModule.updatePaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "payses_1",
        status: PaymentSessionStatus.CAPTURED,
        data: expect.objectContaining({
          payment_status: "CAPTURED",
          razorpay_payment_status: "captured",
          razorpay_payment_id: "pay_test_1",
          correlation_id: "corr_recon_1",
        }),
      })
    )

    const infoLogs = parseSerializedLogs(logger.info as jest.Mock)
    expect(
      infoLogs.some(
        (entry) =>
          entry.message === "PAYMENT_PROVIDER_CALL" &&
          (entry.meta as Record<string, unknown>)?.method === "status.fetch" &&
          (entry.meta as Record<string, unknown>)?.success === true
      )
    ).toBe(true)
    expect(
      infoLogs.some(
        (entry) =>
          entry.message === "PAYMENT_RECONCILE_RUN" &&
          (entry.meta as Record<string, unknown>)?.success === true
      )
    ).toBe(true)
  })

  it("skips non-stale sessions", async () => {
    const now = Date.parse("2026-02-20T12:00:00.000Z")
    const updatedAt = new Date(now - 5 * 60 * 1000).toISOString()
    const { container, paymentModule, getStatus } = makeContainer({
      rows: [
        {
          id: "payses_2",
          provider_id: "pp_razorpay_razorpay",
          status: "pending",
          amount: 999,
          currency_code: "INR",
          updated_at: updatedAt,
          data: {
            payment_status: "CAPTURED",
          },
        },
      ],
    })

    const result = await runStuckPaymentReconciliation(container, {
      now_ms: now,
      stuck_minutes: 30,
    })

    expect(result).toEqual({
      scanned: 1,
      candidates: 0,
      reconciled: 0,
      skipped: 0,
    })
    expect(getStatus).not.toHaveBeenCalled()
    expect(paymentModule.updatePaymentSession).not.toHaveBeenCalled()
  })

  it("skips invalid regressive transitions idempotently", async () => {
    const now = Date.parse("2026-02-20T12:00:00.000Z")
    const updatedAt = new Date(now - 2 * 60 * 60 * 1000).toISOString()
    const { container, paymentModule, getStatus } = makeContainer({
      rows: [
        {
          id: "payses_3",
          provider_id: "pp_razorpay_razorpay",
          status: "authorized",
          amount: 1599,
          currency_code: "INR",
          updated_at: updatedAt,
          data: {
            correlation_id: "corr_recon_3",
          },
        },
      ],
      providerStatusResult: {
        status: "pending",
        data: {
          razorpay_payment_status: "pending",
        },
      },
    })

    const result = await runStuckPaymentReconciliation(container, {
      now_ms: now,
      stuck_minutes: 30,
    })

    expect(result).toEqual({
      scanned: 1,
      candidates: 1,
      reconciled: 0,
      skipped: 1,
    })
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(paymentModule.updatePaymentSession).not.toHaveBeenCalled()
  })

  it("throws PROVIDER_UNAVAILABLE and does not regress state when provider status fetch fails", async () => {
    const now = Date.parse("2026-02-20T12:00:00.000Z")
    const updatedAt = new Date(now - 90 * 60 * 1000).toISOString()
    const { container, paymentModule, logger } = makeContainer({
      rows: [
        {
          id: "payses_4",
          provider_id: "pp_razorpay_razorpay",
          status: "pending",
          amount: 2499,
          currency_code: "INR",
          updated_at: updatedAt,
          data: {
            correlation_id: "corr_recon_4",
          },
        },
      ],
      providerStatusError: new Error("upstream unavailable"),
    })

    await expect(
      runStuckPaymentReconciliation(container, {
        now_ms: now,
        stuck_minutes: 30,
      })
    ).rejects.toMatchObject({
      code: PaymentErrorCode.PROVIDER_UNAVAILABLE,
      correlation_id: "corr_recon_4",
    })
    expect(paymentModule.updatePaymentSession).not.toHaveBeenCalled()

    const errorLogs = parseSerializedLogs(logger.error as jest.Mock)
    expect(
      errorLogs.some(
        (entry) =>
          entry.message === "PAYMENT_PROVIDER_CALL" &&
          (entry.meta as Record<string, unknown>)?.method === "status.fetch" &&
          (entry.meta as Record<string, unknown>)?.success === false &&
          (entry.meta as Record<string, unknown>)?.error_code ===
            PaymentErrorCode.PROVIDER_UNAVAILABLE
      )
    ).toBe(true)
    expect(
      errorLogs.some(
        (entry) =>
          entry.message === "PAYMENT_RECONCILE_RUN" &&
          (entry.meta as Record<string, unknown>)?.success === false
      )
    ).toBe(true)
  })

  it("throws when scan query fails", async () => {
    const { container } = makeContainer({
      queryError: new Error("query failed"),
    })

    await expect(runStuckPaymentReconciliation(container)).rejects.toThrow(
      "query failed"
    )
  })
})
