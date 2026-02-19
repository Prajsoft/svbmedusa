# Return QC Stuck Runbook

## Symptoms

- `GET /admin/ops/attention/returns` shows a return with `current_state: "received"`.
- Return remains in received state beyond configured QC threshold.
- Alert exists for QC delay.

## Checks

- Open `GET /admin/ops/order/:id/timeline`.
- Confirm:
  - `return.received` exists.
  - No subsequent `return.qc_passed` or `return.qc_failed`.
- Check for `ops.alert.raised` with `type: "returns_qc_stuck"`.
- Note `last_error_code` if present in attention data.

## Likely Causes

- Warehouse QC backlog.
- Return processed to received state, but QC workflow not executed.
- Operational handoff gap between receiving and QC teams.

## Resolution Steps

1. Identify `order_id` and `return_id`.
2. Run return admin action (QC outcome):
   - `POST /admin/returns/orders/:order_id/:return_id/actions`
   - Body for pass: `{ "action": "qc_pass", "idempotency_key": "<key>" }`
   - Body for fail: `{ "action": "qc_fail", "idempotency_key": "<key>" }`
3. If needed, close return via:
   - `POST /admin/returns/orders/:order_id/:return_id/actions`
   - Body: `{ "action": "close", "idempotency_key": "<key>" }`

## Verification Steps

- `GET /admin/ops/attention/returns` no longer lists the return.
- Timeline shows:
  - `return.qc_passed` or `return.qc_failed`.
  - Follow-up state completion event(s), such as close/refund events when applicable.
- Repeating the same idempotency key does not duplicate state changes.
