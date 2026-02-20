# Payments State Machine (v1)

## Canonical Statuses

- `PENDING`
- `AUTHORIZED`
- `CAPTURED`
- `FAILED`
- `CANCELLED`
- `REFUNDED`

Note: legacy alias `CANCELED` is accepted in code, but canonical docs/status language is `CANCELLED`.

## Allowed Transitions

- `PENDING -> AUTHORIZED`
- `PENDING -> CAPTURED`
- `PENDING -> FAILED`
- `PENDING -> CANCELLED`
- `AUTHORIZED -> CAPTURED`
- `AUTHORIZED -> FAILED`
- `AUTHORIZED -> CANCELLED`
- `CAPTURED -> REFUNDED`

Terminal statuses:

- `FAILED` (no forward transitions)
- `CANCELLED` (no forward transitions)
- `REFUNDED` (no forward transitions)

## Illegal Transitions

Examples:

- `CAPTURED -> AUTHORIZED`
- `FAILED -> CAPTURED`
- `CANCELLED -> AUTHORIZED`
- `REFUNDED -> CAPTURED`

Required error code for illegal transitions:

- `STATE_TRANSITION_INVALID`

## Idempotency Rules

- Re-applying the same status is a no-op and must not error.
  - Example: `AUTHORIZED -> AUTHORIZED` returns idempotent result.
- Replayed webhook events that resolve to the same status are no-op.
- Invalid backward transitions are rejected (or no-op when explicitly configured for reconciliation/webhook safety paths).

## Paid Truth Policy

- Checkout authorization flow sets `AUTHORIZED`.
- Webhook `payment.captured` sets `CAPTURED`.
- Webhook `payment.failed` sets `FAILED`.

Razorpay nuance:

- Razorpay may emit `captured` without an observed prior `authorized` event (auto-capture or delivery ordering).
- Therefore `PENDING -> CAPTURED` is valid.

## Reconciliation Rules

Reconciliation can only reconcile forward:

- `PENDING -> AUTHORIZED | CAPTURED | FAILED | CANCELLED`
- `AUTHORIZED -> CAPTURED | FAILED | CANCELLED`
- `CAPTURED -> REFUNDED`

Reconciliation must not regress:

- Never move from `CAPTURED` back to `AUTHORIZED`.
- Never move terminal statuses backward to non-terminal statuses.

## Reference Types

- `payments/types.ts`
  - `PaymentStatus`
  - `PaymentErrorCode`
  - `PaymentEvent`
  - Standard error shape `{ code, message, details, correlation_id }`
- `payments/stateMachine.ts`
  - `canTransition(from, to)`
  - `applyTransition(current, to, { correlation_id, on_invalid? })`
  - `logPaymentStateChange({ payment_id, from, to, source, correlation_id })`

## Validator Contract

Transition validator signature:

```ts
(current: PaymentStatus, next: PaymentStatus) => boolean
```

Status transition executor behavior:

- same-state: idempotent no-op
- legal transition: apply transition
- illegal transition: throw `STATE_TRANSITION_INVALID` (unless explicitly configured as noop mode)

## Runtime Wiring

- Canonical transition engine: `payments/stateMachine.ts`
- Backward-compatible adapter for existing modules: `src/modules/payments-core/state-machine.ts`
- Observability for status moves should use `logPaymentStateChange(...)` so every transition includes `correlation_id`
