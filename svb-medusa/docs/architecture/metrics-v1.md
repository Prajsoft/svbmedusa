# Metrics Instrumentation (V1)

## Scope

This version adds an in-app metrics registry for workflow and business-action observability.
It is process-local (in-memory), intended for development/staging visibility and unit-test assertions.

## Registry

Implemented at `src/modules/observability/metrics.ts`.

Supported primitives:

- `increment(name, labels?)`
- `observeDuration(name, ms, labels?)`
- `getMetricsSnapshot()`

## Metric Names

### Order placement

- `workflow.order_place.duration_ms` (timer)
- `workflow.order_place.success_total` (counter)
- `workflow.order_place.failure_total` (counter)

### Fulfillment request

- `workflow.fulfillment_request.duration_ms` (timer)
- `workflow.fulfillment_request.success_total` (counter)
- `workflow.fulfillment_request.failure_total` (counter)

### Return request

- `workflow.return_request.success_total` (counter)
- `workflow.return_request.failure_total` (counter)

### Coupon apply

- `workflow.coupon_apply.success_total` (counter)
- `workflow.coupon_apply.failure_total` (counter)

## Label Conventions

Common labels:

- `workflow`: logical workflow name (example: `order_place`)
- `result`: `success` or `failure`
- `error_code`: stable application code on failures (when available)

Additional labels currently used:

- `order_id` on fulfillment-request instrumentation

## Dev Snapshot Endpoint

Route: `GET /admin/observability/metrics`

- Enabled only when `NODE_ENV=development`
- Returns current metrics snapshot as:
  - `generated_at`
  - `counters[]`
  - `timers[]`
- Outside development, returns:
  - `404`
  - `{ "code": "METRICS_SNAPSHOT_DISABLED", "message": "Metrics snapshot endpoint is only available in development." }`

## Notes

- This is not a distributed metrics backend.
- For multi-process/prod deployment, add export/shipper integration in a future version.
