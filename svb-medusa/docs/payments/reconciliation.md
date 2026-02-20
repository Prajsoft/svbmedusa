# Payments Reconciliation

## Purpose

Reconciliation is the safety net for missed or delayed webhooks. It scans stale payment sessions and moves them forward using provider status, without regressing state.

Foundation docs:

- Overview: `docs/payments/overview.md`
- State machine: `docs/payments/state-machine.md`
- Webhooks: `docs/payments/webhooks.md`
- Observability: `docs/payments/observability.md`
- Provider checklist: `docs/payments/adding-a-provider.md`

## Job Entry Point

- Job file: `src/jobs/payment-reconciliation.ts`
- Core function: `src/modules/payments-core/reconciliation.ts` (`runStuckPaymentReconciliation`)
- Default schedule: `*/20 * * * *`

## Configuration

| Env var | Meaning | Default |
| --- | --- | --- |
| `PAYMENTS_RECONCILIATION_CRON` | Cron schedule for background job | `*/20 * * * *` |
| `PAYMENTS_RECONCILIATION_STUCK_MINUTES` | Minimum session age before reconciliation | `30` |
| `PAYMENTS_RECONCILIATION_MAX_SESSIONS` | Per-run cap to limit DB/API load | `200` |

## Selection Rules

Only these sessions are candidates:

- Provider id starts with `pp_`
- Current internal status maps to `PENDING` or `AUTHORIZED`
- `updated_at` is older than the configured threshold

## Reconciliation Flow

1. Fetch candidate payment sessions.
2. Call provider status API through `paymentProviderService_.getStatus(provider_id, { data })`.
3. Map provider response to internal `PaymentStatus`.
4. Apply transition through the shared state machine (`transitionPaymentStatus` with idempotent behavior).
5. Persist only forward valid changes (`updatePaymentSession`), including merged provider refs.

## Idempotency and Safety

- Same-state updates are no-ops.
- Illegal/regressive transitions are skipped (no throw, no state regression).
- If provider status cannot be fetched, reconciliation throws `PROVIDER_UNAVAILABLE` and does not mutate payment state.

## Observability

Each run emits structured events:

- `PAYMENT_PROVIDER_CALL` for provider status fetch (`method: status.fetch`)
- `PAYMENT_RECONCILE_RUN` with checked and updated counts
- `PAYMENT_RECONCILIATION_SCAN_STARTED`
- `PAYMENT_RECONCILIATION_SCAN_COMPLETED`
- `PAYMENT_RECONCILIATION_SCAN_FAILED` (error path)
- `PAYMENT_RECONCILIATION_SESSION_RECONCILED` (per updated session)

All logs include `correlation_id`.

## Manual Run (One-Off)

Run the same reconciliation logic manually in a Medusa exec context by calling `runStuckPaymentReconciliation(container, { ... })` from an exec script. Use this for controlled support operations when webhook delivery is degraded.

## Tests

- `src/modules/payments-core/__tests__/reconciliation.unit.spec.ts`
  - stale `PENDING` session progresses to `CAPTURED` when provider returns captured
  - provider fetch failure returns `PROVIDER_UNAVAILABLE` and no state mutation
  - non-stale session is skipped
  - invalid/regressive transition is skipped idempotently
- `src/jobs/__tests__/payment-reconciliation.unit.spec.ts`
  - job delegates to reconciliation core
