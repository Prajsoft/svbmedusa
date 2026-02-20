import paymentReconciliationJob, { config } from "../../jobs/payment-reconciliation"
import { runStuckPaymentReconciliation } from "../../modules/payments-core"

jest.mock("../../modules/payments-core", () => ({
  runStuckPaymentReconciliation: jest.fn(async () => undefined),
}))

describe("payment reconciliation job", () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it("delegates to runStuckPaymentReconciliation", async () => {
    const container = {} as any
    await paymentReconciliationJob(container)

    expect(runStuckPaymentReconciliation).toHaveBeenCalledTimes(1)
    expect(runStuckPaymentReconciliation).toHaveBeenCalledWith(container)
  })

  it("exposes deterministic job metadata", () => {
    expect(config.name).toBe("payment-reconciliation")
    expect(typeof config.schedule).toBe("string")
    expect(config.schedule.length).toBeGreaterThan(0)
  })

  it("surfaces provider downtime gracefully with correlation_id", async () => {
    const runStuckMock = runStuckPaymentReconciliation as jest.Mock
    runStuckMock.mockRejectedValueOnce({
      code: "PROVIDER_UNAVAILABLE",
      correlation_id: "corr_recon_down_1",
      message: "provider unavailable",
      details: {
        payment_session_id: "payses_1",
      },
    })

    await expect(paymentReconciliationJob({} as any)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      correlation_id: "corr_recon_down_1",
    })
    expect(runStuckMock).toHaveBeenCalledTimes(1)
  })
})
