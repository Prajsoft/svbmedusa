import { resolveCorrelationId } from "./correlation"
import { logStructured } from "./structured-logger"

type LogEventLevel = "debug" | "info" | "warn" | "error"

type LogEventOptions = {
  level?: LogEventLevel
  scopeOrLogger?: unknown
}

export function logEvent(
  eventName: string,
  payload: Record<string, unknown> = {},
  correlation_id?: string,
  options: LogEventOptions = {}
): Record<string, unknown> {
  const correlationId = resolveCorrelationId(correlation_id)

  return logStructured(
    options.scopeOrLogger as any,
    options.level ?? "info",
    eventName,
    {
      correlation_id: correlationId,
      meta: payload,
    }
  )
}
