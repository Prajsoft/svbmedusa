# COD Capture Pending Runbook

## Symptoms

- `GET /admin/ops/attention/cod` lists the order.
- Order is delivered, but COD payment is not captured.
- Alert exists for delayed COD capture.

## Checks

- Open `GET /admin/ops/order/:id/timeline`.
- Confirm:
  - Delivery-related fulfillment event exists (for example `fulfillment.status_changed` to delivered).
  - `payment.authorized`/`cod.authorized` exists.
  - `cod.captured` does not exist yet.
- Check for `ops.alert.raised` with `type: "cod_capture_pending"`.

## Likely Causes

- Delivery completed, but capture action was not executed.
- COD payment remained in authorized state.
- Ops process gap between delivery confirmation and finance capture.

## Resolution Steps

1. Run ops action:
   - `POST /admin/ops/actions/mark-cod-captured`
   - Body: `{ "order_id": "<order_id>" }`
2. If a correction/refund is needed after capture, run:
   - `POST /admin/ops/actions/record-cod-refund`
   - Body: `{ "order_id": "<order_id>", "amount": <amount>, "reason": "<reason>" }`

## Verification Steps

- `GET /admin/ops/attention/cod` no longer lists the order.
- Timeline shows:
  - `ops.action.executed` with action `mark-cod-captured`.
  - `cod.captured` event.
- Re-running capture action returns `status: "noop"` (idempotent behavior).
