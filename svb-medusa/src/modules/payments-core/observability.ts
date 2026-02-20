import { logEvent } from "../logging/log-event"

export function logPaymentProviderEvent(
  eventName: string,
  input: {
    provider: string
    correlation_id: string
    endpoint?: string
    status?: number | null
    details?: Record<string, unknown>
  },
  options: {
    level?: "debug" | "info" | "warn" | "error"
    scopeOrLogger?: unknown
  } = {}
): void {
  logEvent(
    eventName,
    {
      provider: input.provider,
      endpoint: input.endpoint ?? null,
      status: input.status ?? null,
      ...(input.details ?? {}),
    },
    input.correlation_id,
    {
      level: options.level ?? "info",
      scopeOrLogger: options.scopeOrLogger,
    }
  )
}
