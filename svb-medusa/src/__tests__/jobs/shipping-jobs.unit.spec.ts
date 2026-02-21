const runShippingBookingRecoveryMock = jest.fn(async () => undefined)
const runShippingWebhookReplayMock = jest.fn(async () => undefined)
const getShippingPersistenceRepositoryMock = jest.fn(() => ({
  purgeExpiredSanitizedPayloads: jest.fn(async () => ({
    ttl_days: 90,
    cutoff_at: new Date("2026-01-01T00:00:00.000Z"),
    scrubbed_count: 3,
  })),
}))

jest.mock("../../modules/shipping/booking-recovery", () => ({
  runShippingBookingRecovery: (...args: unknown[]) =>
    runShippingBookingRecoveryMock(...args),
}))

jest.mock("../../modules/shipping/webhook-replay", () => ({
  runShippingWebhookReplay: (...args: unknown[]) =>
    runShippingWebhookReplayMock(...args),
}))

jest.mock("../../modules/shipping/provider-router", () => ({
  getShippingPersistenceRepository: (...args: unknown[]) =>
    getShippingPersistenceRepositoryMock(...args),
}))

const bookingRecoveryModule = require("../../jobs/shipping-booking-recovery")
const webhookReplayModule = require("../../jobs/shipping-webhook-replay")
const payloadPurgeModule = require("../../jobs/shipping-events-payload-purge")

const shippingBookingRecoveryJob = bookingRecoveryModule.default as (
  container: unknown
) => Promise<void>
const bookingRecoveryConfig = bookingRecoveryModule.config as {
  name: string
  schedule: string
}
const shippingWebhookReplayJob = webhookReplayModule.default as (
  container: unknown
) => Promise<void>
const webhookReplayConfig = webhookReplayModule.config as {
  name: string
  schedule: string
}
const shippingEventsPayloadPurgeJob = payloadPurgeModule.default as (
  container: unknown
) => Promise<void>
const payloadPurgeConfig = payloadPurgeModule.config as {
  name: string
  schedule: string
}

describe("shipping jobs", () => {
  beforeEach(() => {
    runShippingBookingRecoveryMock.mockClear()
    runShippingWebhookReplayMock.mockClear()
    getShippingPersistenceRepositoryMock.mockClear()
    getShippingPersistenceRepositoryMock.mockImplementation(() => ({
      purgeExpiredSanitizedPayloads: jest.fn(async () => ({
        ttl_days: 90,
        cutoff_at: new Date("2026-01-01T00:00:00.000Z"),
        scrubbed_count: 3,
      })),
    }))
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it("delegates booking recovery job", async () => {
    const container = {} as any
    await shippingBookingRecoveryJob(container)
    expect(runShippingBookingRecoveryMock).toHaveBeenCalledTimes(1)
    expect(runShippingBookingRecoveryMock).toHaveBeenCalledWith(container)
  })

  it("delegates webhook replay job", async () => {
    const container = {} as any
    await shippingWebhookReplayJob(container)
    expect(runShippingWebhookReplayMock).toHaveBeenCalledTimes(1)
    expect(runShippingWebhookReplayMock).toHaveBeenCalledWith(container)
  })

  it("delegates payload purge via repository helper", async () => {
    const container = {
      resolve: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      })),
    } as any

    await shippingEventsPayloadPurgeJob(container)

    expect(getShippingPersistenceRepositoryMock).toHaveBeenCalledWith(container)
    const repository = getShippingPersistenceRepositoryMock.mock.results[0]
      .value as {
      purgeExpiredSanitizedPayloads: jest.Mock
    }
    expect(repository.purgeExpiredSanitizedPayloads).toHaveBeenCalledTimes(1)
  })

  it("exposes deterministic config metadata", () => {
    expect(bookingRecoveryConfig.name).toBe("shipping-booking-recovery")
    expect(typeof bookingRecoveryConfig.schedule).toBe("string")
    expect(bookingRecoveryConfig.schedule.length).toBeGreaterThan(0)

    expect(webhookReplayConfig.name).toBe("shipping-webhook-replay")
    expect(typeof webhookReplayConfig.schedule).toBe("string")
    expect(webhookReplayConfig.schedule.length).toBeGreaterThan(0)

    expect(payloadPurgeConfig.name).toBe("shipping-events-payload-purge")
    expect(typeof payloadPurgeConfig.schedule).toBe("string")
    expect(payloadPurgeConfig.schedule.length).toBeGreaterThan(0)
  })
})
