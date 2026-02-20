export const RAZORPAY_WEBHOOK_EVENTS_TABLE = "razorpay_webhook_events"

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
  id: string
  event_type: string
  provider_payment_id?: string
}

export class RazorpayWebhookEventRepository {
  constructor(private readonly pgConnection: PgConnectionLike) {}

  async ensureSchema(): Promise<void> {
    await this.pgConnection.raw(`
      CREATE TABLE IF NOT EXISTS ${RAZORPAY_WEBHOOK_EVENTS_TABLE} (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        provider_payment_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
  }

  async markProcessed(input: MarkProcessedInput): Promise<{
    processed: boolean
    already_processed: boolean
  }> {
    const result = await this.pgConnection.raw(
      `
        INSERT INTO ${RAZORPAY_WEBHOOK_EVENTS_TABLE} (id, event_type, provider_payment_id)
        VALUES (?, ?, ?)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [input.id, input.event_type, input.provider_payment_id ?? null]
    )

    const inserted = Array.isArray(result.rows) && result.rows.length > 0
    return {
      processed: inserted,
      already_processed: !inserted,
    }
  }

  async isProcessed(id: string): Promise<boolean> {
    const result = await this.pgConnection.raw(
      `SELECT id FROM ${RAZORPAY_WEBHOOK_EVENTS_TABLE} WHERE id = ?`,
      [id]
    )

    return readText(result.rows?.[0]?.id).length > 0
  }
}
