# Payments Observability

## Scope

Payments observability is standardized through:

- `payments/observability.ts`
- `src/modules/logging/log-event.ts`
- `src/modules/logging/structured-logger.ts`

All payment logs must include `correlation_id`.

## Required Event Shapes

### Provider Call Event

Emitter:

- `logProviderCall(...)`

Structured event:

- `message = "PAYMENT_PROVIDER_CALL"`
- required fields (inside `meta`):
  - `provider`
  - `method`
  - `duration_ms`
  - `success`
  - optional `error_code`
  - optional `payment_id`
  - optional `payment_session_id`

### Webhook Event

Emitter:

- `logWebhookEvent(...)`

Structured event:

- `message = "PAYMENT_WEBHOOK_EVENT"`
- required fields (inside `meta`):
  - `provider`
  - `event_type`
  - `event_id`
  - `matched`
  - `deduped`
  - `success`

### Reconciliation Run Event

Emitter:

- `logReconcileRun(...)`

Structured event:

- `message = "PAYMENT_RECONCILE_RUN"`
- required fields (inside `meta`):
  - `provider`
  - `checked_count`
  - `updated_count`
  - `success`

## Metrics Hooks

Metrics module:

- `src/modules/observability/metrics.ts`

Payment metrics emitted:

- `payments.provider.call.total`
- `payments.provider.call.duration_ms`
- `payments.webhook.event.total`
- `payments.reconcile.run.total`

Dev snapshot endpoint:

- `GET /admin/observability/metrics`
- enabled in `NODE_ENV=development` only

## Query Examples

### Find failed provider calls

Filter logs where:

- `message = "PAYMENT_PROVIDER_CALL"`
- `meta.success = false`

### Find webhook signature failures

Filter logs where:

- `message = "PAYMENT_WEBHOOK_FAILED"` or `message = "PAYMENT_WEBHOOK_EVENT"`
- `meta.error_code = "SIGNATURE_INVALID"` (when present)

### Trace one payment end-to-end

Use one `correlation_id` across:

- `PAYMENT_PROVIDER_CALL`
- `PAYMENT_WEBHOOK_EVENT`
- `PAYMENT_RECONCILE_RUN`
- provider-specific events (for example `RAZORPAY_*`)

## Redaction and Safety

Redaction rules are enforced by structured logger sanitization:

- redact keys matching secret/token/password/authorization/cookie/api_key/private_key
- redact address-like keys
- truncate long strings/objects for safety

Do not log:

- provider secrets
- authorization headers
- raw webhook payloads with PII
