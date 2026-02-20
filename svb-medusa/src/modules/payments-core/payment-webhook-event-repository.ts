export const PAYMENT_WEBHOOK_EVENTS_TABLE = "payment_webhook_events"

type QueryResultLike = {
  rows?: Array<Record<string, unknown>>
}

type PgConnectionLike = {
  raw: (query: string, bindings?: unknown[]) => Promise<QueryResultLike>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export type MarkProcessedInput = {
  provider: string
  event_id: string
}

export class PaymentWebhookEventRepository {
  private schemaEnsured = false

  constructor(private readonly pgConnection: PgConnectionLike) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) {
      return
    }

    await this.pgConnection.raw(`
      CREATE TABLE IF NOT EXISTS ${PAYMENT_WEBHOOK_EVENTS_TABLE} (
        provider TEXT NOT NULL,
        event_id TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider, event_id)
      )
    `)

    this.schemaEnsured = true
  }

  async markProcessed(input: MarkProcessedInput): Promise<{
    processed: boolean
    already_processed: boolean
  }> {
    await this.ensureSchema()

    const provider = readText(input.provider).toLowerCase()
    const eventId = readText(input.event_id)

    const result = await this.pgConnection.raw(
      `
        INSERT INTO ${PAYMENT_WEBHOOK_EVENTS_TABLE} (provider, event_id)
        VALUES (?, ?)
        ON CONFLICT (provider, event_id) DO NOTHING
        RETURNING provider, event_id
      `,
      [provider, eventId]
    )

    const inserted = Array.isArray(result.rows) && result.rows.length > 0
    return {
      processed: inserted,
      already_processed: !inserted,
    }
  }
}

