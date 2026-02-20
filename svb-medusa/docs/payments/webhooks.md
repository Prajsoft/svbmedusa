# Payments Webhooks

## Route Pattern

Canonical endpoint:

- `POST /webhooks/payments/:provider`
- Route file: `src/api/webhooks/payments/[provider]/route.ts`

Compatibility alias (Razorpay):

- `POST /webhooks/razorpay`
- Route file: `src/api/webhooks/razorpay/route.ts`
- Behavior: sets `provider=razorpay` and delegates to shared route.
- Status: deprecated compatibility path; keep only while external webhook configs migrate.
- Response headers include:
  - `x-webhook-endpoint-deprecated: true`
  - `x-webhook-endpoint-canonical: /webhooks/payments/razorpay`

Legacy Medusa provider hook path may still be available:

- `POST /hooks/payment/:provider_id`
- For Razorpay this resolves as `POST /hooks/payment/razorpay_razorpay`
- Foundation policy/reconciliation behavior in this project is standardized around `/webhooks/payments/:provider`.

## Shared Pipeline

Pipeline implementation:

- `src/modules/payments-core/webhook-pipeline.ts`
- Provider verifier/mapper registry:
  - `src/modules/payments-core/webhook-provider-registry.ts`
- Razorpay provider legacy hook path (`getWebhookActionAndData`) also reuses the same registry verifier/mapper to avoid duplicate signature/mapping logic.

Pipeline steps:

1. Resolve `correlation_id` and set response header `x-correlation-id`.
2. Resolve provider verifier/mapper from registry.
3. Verify signature for provider.
4. Map raw payload to internal `PaymentEvent`.
5. Dedupe by `(provider, event_id)`.
6. Load payment session and apply state transition via state machine.
7. Persist provider refs + status updates idempotently.
8. Emit structured webhook observability events.

## Dedupe Table

Repository:

- `src/modules/payments-core/payment-webhook-event-repository.ts`

Table:

- `payment_webhook_events`
  - `provider` (`TEXT`, required)
  - `event_id` (`TEXT`, required)
  - `received_at` (`TIMESTAMPTZ`, default `NOW()`)
  - unique constraint: `(provider, event_id)`

Duplicate behavior:

- second delivery with same `(provider, event_id)` is ignored
- route returns HTTP `200` with `processed=false`, `deduped=true`
- emits `WEBHOOK_DEDUP_HIT`

## Security Defaults

Verifier policy:

- default: reject unverifiable/unsigned webhooks
- override flags:
  - `PAYMENTS_ALLOW_UNVERIFIED_WEBHOOKS=true`
  - alias supported: `ALLOW_UNSIGNED_WEBHOOKS=true`
- policy helper: `src/modules/payments-core/webhook-policy.ts`

If verification fails and override is disabled:

- response: `401`
- error code: `SIGNATURE_INVALID`
- response shape:
  - `{ "error": { "code", "message", "details", "correlation_id" } }`

## Event Mapping Rules (Current)

Current registry includes Razorpay mapper/verifier.

- `payment.authorized` -> `AUTHORIZED`
- `payment.captured` -> `CAPTURED`
- `payment.failed` -> `FAILED`

Unsupported/invalid mapping:

- response `400`
- code `VALIDATION_ERROR`

## Status Update Rules

- transitions flow through shared state machine only
- idempotent same-state updates are no-op
- invalid backward transitions are skipped/no-op in webhook mode (`on_invalid: "noop"`)
- persisted status mapping:
  - `AUTHORIZED` -> `payment_session.status=authorized`
  - `CAPTURED` -> `payment_session.status=captured`
  - `FAILED` -> `payment_session.status=error`

## Operational Notes

- Webhook processing logs include `correlation_id`.
- Never log raw secrets/authorization headers.
- Do not trust client payloads outside verified provider signature path.
