# Stuck Fulfillment Runbook

## Symptoms

- `GET /admin/ops/attention/fulfillments` includes an item with `current_state: "requested"`.
- The same fulfillment stays in attention for longer than expected.
- You may also see `fulfillment.request_failed` events for the order.

## Checks

- Open `GET /admin/ops/order/:id/timeline`.
- Confirm the most recent fulfillment events:
  - `fulfillment.requested` exists.
  - No later `fulfillment.status_changed` to `ready_for_shipment` or beyond.
- Check for `ops.alert.raised` with `type: "stuck_fulfillment"`.
- Check `last_error_code` from attention payload and matching error details in events.

## Likely Causes

- Shipment contract/logistics validation failed.
- Workflow execution failed after order placement.
- Fulfillment was never moved forward by ops after being requested.

## Resolution Steps

1. Run ops action:
   - `POST /admin/ops/actions/retry-fulfillment`
   - Body: `{ "order_id": "<order_id>" }`
2. If retry returns `noop` but issue remains, run:
   - `POST /admin/ops/actions/rebuild-shipment-contract`
   - Body: `{ "order_id": "<order_id>" }`
3. Run retry again:
   - `POST /admin/ops/actions/retry-fulfillment`
4. If still failing, review timeline errors and fix underlying data issue, then retry once more.

## Verification Steps

- `GET /admin/ops/attention/fulfillments` no longer lists the stuck entity.
- Timeline shows:
  - `ops.action.executed` for the action(s) run.
  - A new or updated `fulfillment.requested` event.
  - Subsequent progression event(s), such as `fulfillment.status_changed`.
- `last_error_code` is cleared or no new failure appears.
