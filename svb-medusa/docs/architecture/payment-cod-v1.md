# COD Payment Lifecycle v1

## Purpose

Define a stable contract for Cash on Delivery (COD) payment lifecycle behavior in this Medusa backend.

## State Machine

### States

- `session_created`
- `authorized`
- `captured`
- `refunded`

### Transitions

- `session_created -> authorized`
  - Trigger: customer selects COD and checkout authorization succeeds.
  - Outcome: order placement is allowed.

- `authorized -> captured`
  - Trigger: delivery confirmation or manual operations action (v1).
  - Outcome: COD payment is marked captured.

- `captured -> refunded`
  - Trigger: manual refund record creation (v1).
  - Outcome: COD refund is recorded.

## Lifecycle Rules

- COD authorization happens during checkout before order placement.
- Capture is not automatic at order placement.
- Refund for COD is a record plus audit event in v1 (no external provider API call).

## Idempotency Rules

- `payment_init` is idempotent per `cart_id`.
- `authorize` is idempotent per `payment_session_id`.
- `capture` is idempotent per `order_id`.

## Required Audit Events

- `cod.authorized`
- `cod.captured`
- `cod.refund_recorded`

## v1 Operational Notes

- Capture and refund actions are operationally controlled (manual and/or internal workflow trigger).
- Duplicate requests for idempotent operations must not create duplicate state transitions or duplicate audit records.
