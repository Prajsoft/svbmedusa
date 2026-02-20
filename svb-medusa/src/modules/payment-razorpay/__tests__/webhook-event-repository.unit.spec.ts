import {
  RAZORPAY_WEBHOOK_EVENTS_TABLE,
  RazorpayWebhookEventRepository,
} from "../webhook-event-repository"

type QueryResultLike = {
  rows?: Array<Record<string, unknown>>
}

function makeRepository() {
  const events = new Set<string>()
  const raw = jest.fn(
    async (query: string, bindings: unknown[] = []): Promise<QueryResultLike> => {
      if (query.includes("CREATE TABLE")) {
        return { rows: [] }
      }

      if (query.includes(`INSERT INTO ${RAZORPAY_WEBHOOK_EVENTS_TABLE}`)) {
        const eventId = String(bindings[0] ?? "")
        if (events.has(eventId)) {
          return { rows: [] }
        }

        events.add(eventId)
        return { rows: [{ id: eventId }] }
      }

      if (query.includes(`SELECT id FROM ${RAZORPAY_WEBHOOK_EVENTS_TABLE}`)) {
        const eventId = String(bindings[0] ?? "")
        return {
          rows: events.has(eventId) ? [{ id: eventId }] : [],
        }
      }

      return { rows: [] }
    }
  )

  return {
    repository: new RazorpayWebhookEventRepository({ raw }),
    raw,
  }
}

describe("RazorpayWebhookEventRepository", () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it("marks duplicate event ids as already processed", async () => {
    const { repository } = makeRepository()
    await repository.ensureSchema()

    const first = await repository.markProcessed({
      id: "evt_001",
      event_type: "payment.authorized",
      provider_payment_id: "pay_001",
    })
    const second = await repository.markProcessed({
      id: "evt_001",
      event_type: "payment.authorized",
      provider_payment_id: "pay_001",
    })

    expect(first).toEqual({
      processed: true,
      already_processed: false,
    })
    expect(second).toEqual({
      processed: false,
      already_processed: true,
    })
  })

  it("reports processed status by event id", async () => {
    const { repository } = makeRepository()
    await repository.ensureSchema()

    await repository.markProcessed({
      id: "evt_200",
      event_type: "payment.captured",
      provider_payment_id: "pay_200",
    })

    await expect(repository.isProcessed("evt_200")).resolves.toBe(true)
    await expect(repository.isProcessed("evt_missing")).resolves.toBe(false)
  })
})
