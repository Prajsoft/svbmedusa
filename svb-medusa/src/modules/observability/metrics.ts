type MetricLabelValue = string | number | boolean | null | undefined
export type MetricLabels = Record<string, MetricLabelValue>

type CounterEntry = {
  name: string
  labels: Record<string, string>
  value: number
}

type TimerEntry = {
  name: string
  labels: Record<string, string>
  count: number
  sum_ms: number
  min_ms: number
  max_ms: number
  last_ms: number
}

export type MetricsSnapshot = {
  generated_at: string
  counters: CounterEntry[]
  timers: Array<
    TimerEntry & {
      avg_ms: number
    }
  >
}

const counters = new Map<string, CounterEntry>()
const timers = new Map<string, TimerEntry>()

function normalizeName(name: string): string {
  return String(name ?? "").trim()
}

function normalizeLabels(labels?: MetricLabels): Record<string, string> {
  if (!labels || typeof labels !== "object") {
    return {}
  }

  const normalized: Record<string, string> = {}

  for (const [key, rawValue] of Object.entries(labels)) {
    const normalizedKey = String(key ?? "").trim()
    if (!normalizedKey) {
      continue
    }

    if (rawValue === undefined || rawValue === null) {
      continue
    }

    const normalizedValue = String(rawValue).trim()
    if (!normalizedValue) {
      continue
    }

    normalized[normalizedKey] = normalizedValue
  }

  return normalized
}

function metricKey(name: string, labels: Record<string, string>): string {
  const parts = Object.keys(labels)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${labels[key]}`)

  return parts.length ? `${name}|${parts.join(",")}` : name
}

function toFiniteMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return value < 0 ? 0 : value
}

export function increment(name: string, labels?: MetricLabels): void {
  const metricName = normalizeName(name)
  if (!metricName) {
    return
  }

  const normalizedLabels = normalizeLabels(labels)
  const key = metricKey(metricName, normalizedLabels)
  const existing = counters.get(key)

  if (existing) {
    existing.value += 1
    return
  }

  counters.set(key, {
    name: metricName,
    labels: normalizedLabels,
    value: 1,
  })
}

export function observeDuration(
  name: string,
  ms: number,
  labels?: MetricLabels
): void {
  const metricName = normalizeName(name)
  if (!metricName) {
    return
  }

  const normalizedLabels = normalizeLabels(labels)
  const key = metricKey(metricName, normalizedLabels)
  const durationMs = toFiniteMs(ms)
  const existing = timers.get(key)

  if (!existing) {
    timers.set(key, {
      name: metricName,
      labels: normalizedLabels,
      count: 1,
      sum_ms: durationMs,
      min_ms: durationMs,
      max_ms: durationMs,
      last_ms: durationMs,
    })
    return
  }

  existing.count += 1
  existing.sum_ms += durationMs
  existing.min_ms = Math.min(existing.min_ms, durationMs)
  existing.max_ms = Math.max(existing.max_ms, durationMs)
  existing.last_ms = durationMs
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const counterEntries = Array.from(counters.values())
    .map((entry) => ({
      name: entry.name,
      labels: { ...entry.labels },
      value: entry.value,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const timerEntries = Array.from(timers.values())
    .map((entry) => ({
      name: entry.name,
      labels: { ...entry.labels },
      count: entry.count,
      sum_ms: entry.sum_ms,
      min_ms: entry.min_ms,
      max_ms: entry.max_ms,
      last_ms: entry.last_ms,
      avg_ms: entry.count > 0 ? entry.sum_ms / entry.count : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    generated_at: new Date().toISOString(),
    counters: counterEntries,
    timers: timerEntries,
  }
}

export function __resetMetricsForTests(): void {
  counters.clear()
  timers.clear()
}
