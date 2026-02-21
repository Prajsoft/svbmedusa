import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { logStructured } from "../logging/structured-logger"
import {
  DEFAULT_SHIPPING_WEBHOOK_REPLAY_BATCH_SIZE,
  ShippingPersistenceRepository,
  type ReplayBufferedEventsInput,
  type ReplayBufferedEventsResult,
} from "./shipment-persistence"

type ScopeLike = {
  resolve: (key: string) => any
}

type PgConnectionLike = {
  raw: (query: string, bindings?: unknown[]) => Promise<{
    rows?: Array<Record<string, unknown>>
  }>
}

export async function runShippingWebhookReplay(
  scope: ScopeLike,
  input: ReplayBufferedEventsInput = {}
): Promise<ReplayBufferedEventsResult> {
  const pgConnection = scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as PgConnectionLike

  if (!pgConnection || typeof pgConnection.raw !== "function") {
    throw new Error("PG connection is unavailable for shipping webhook replay.")
  }

  const configuredLimit = Number(process.env.SHIPPING_WEBHOOK_REPLAY_BATCH_SIZE)
  const fallbackLimit =
    Number.isFinite(configuredLimit) && configuredLimit > 0
      ? Math.floor(configuredLimit)
      : DEFAULT_SHIPPING_WEBHOOK_REPLAY_BATCH_SIZE

  const repository = new ShippingPersistenceRepository(pgConnection)
  const result = await repository.replayBufferedEvents({
    limit: input.limit ?? fallbackLimit,
    now: input.now,
  })

  logStructured(scope as any, "info", "shipping webhook replay executed", {
    workflow_name: "shipping_webhook_replay",
    step_name: "replay_buffered_events",
    meta: {
      scanned: result.scanned,
      processed: result.processed,
      buffered: result.buffered,
      deduped: result.deduped,
      updated: result.updated,
    },
  })

  return result
}
