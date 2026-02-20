import {
  PAYMENT_WEBHOOK_EVENTS_TABLE,
  PaymentWebhookEventRepository,
} from "../payment-webhook-event-repository"

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

      if (query.includes(`INSERT INTO ${PAYMENT_WEBHOOK_EVENTS_TABLE}`)) {
        const provider = String(bindings[0] ?? "").trim().toLowerCase()
        const eventId = String(bindings[1] ?? "").trim()
        const key = `${provider}::${eventId}`

        if (events.has(key)) {
          return { rows: [] }
        }

        events.add(key)
        return { rows: [{ provider, event_id: eventId }] }
      }

      return { rows: [] }
    }
  )

  return {
    repository: new PaymentWebhookEventRepository({ raw }),
    raw,
  }
}

describe("PaymentWebhookEventRepository", () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it("marks duplicate webhook event ids as already processed per provider", async () => {
    const { repository } = makeRepository()

    const first = await repository.markProcessed({
      provider: "razorpay",
      event_id: "evt_001",
    })
    const second = await repository.markProcessed({
      provider: "razorpay",
      event_id: "evt_001",
    })
    const third = await repository.markProcessed({
      provider: "stripe",
      event_id: "evt_001",
    })

    expect(first).toEqual({
      processed: true,
      already_processed: false,
    })
    expect(second).toEqual({
      processed: false,
      already_processed: true,
    })
    expect(third).toEqual({
      processed: true,
      already_processed: false,
    })
  })
})

