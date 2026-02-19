# Ops Actions Runbook (V1)

Admin ops actions are workflow-backed and emit `ops.action.executed` for auditability.

## Endpoints

### `POST /admin/ops/actions/retry-fulfillment`

Body:

```json
{ "order_id": "order_123" }
```

Use when:

- Fulfillment is stuck or previously failed and needs a new fulfillment request attempt.

Behavior:

- Calls workflow `retryFulfillmentActionWorkflow`.
- Idempotent:
  - If the latest fulfillment intent is already `requested`, returns `status: "noop"`.
  - Otherwise creates the next fulfillment attempt and returns `status: "applied"`.

### `POST /admin/ops/actions/rebuild-shipment-contract`

Body:

```json
{ "order_id": "order_123" }
```

Use when:

- Product logistics metadata was fixed and shipment contract summary must be rebuilt.

Behavior:

- Calls workflow `rebuildShipmentContractActionWorkflow`.
- Idempotent:
  - If rebuilt summary matches existing summary, returns `status: "noop"`.
  - If changed, updates summary and returns `status: "applied"`.

### `POST /admin/ops/actions/mark-cod-captured`

Body:

```json
{ "order_id": "order_123" }
```

Use when:

- COD delivery is confirmed and payment must be marked as captured.

Behavior:

- Calls workflow `markCodCapturedActionWorkflow` (which delegates to COD capture workflow).
- Idempotent:
  - Already captured => `status: "noop"`.
  - Newly captured => `status: "applied"`.

### `POST /admin/ops/actions/record-cod-refund`

Body:

```json
{ "order_id": "order_123", "amount": 499, "reason": "Approved return refund" }
```

Use when:

- COD refund payout needs to be recorded.

Behavior:

- Calls workflow `recordCodRefundActionWorkflow` (delegates to COD refund workflow).
- Idempotent:
  - Same refund record already exists => `status: "noop"`.
  - New refund record => `status: "applied"`.

## Audit Event

Each action emits:

- `ops.action.executed`

Event payload includes:

- `action`
- `order_id`
- `status` (`applied` or `noop`)
- `actor_id`
- action-specific details (for example `fulfillment_attempt`, `payment_id`, `amount`, `reason`)

Correlation:

- Uses request `correlation_id` when available.
