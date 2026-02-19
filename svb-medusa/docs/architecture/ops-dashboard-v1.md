# Ops Dashboard API (V1)

Data-only admin endpoints for operations dashboards. UI rendering is intentionally out of scope.

## Endpoints

### `GET /admin/ops/attention/orders`

Returns orders requiring generic ops attention (for example pending fulfillment state or recorded order-level error).

### `GET /admin/ops/attention/fulfillments`

Returns fulfillment entities needing action (for example long-running `requested` intents or `delivery_failed`).

### `GET /admin/ops/attention/cod`

Returns COD orders requiring capture attention (delivered but COD capture still pending beyond configured threshold).

### `GET /admin/ops/attention/returns`

Returns returns requiring QC action (for example `received` returns without QC outcome beyond configured threshold).

### `GET /admin/ops/order/:id/timeline`

Returns persisted audit/business events for the given order in chronological order.

## Attention Response Shape

Attention endpoints return:

```json
{
  "items": [
    {
      "entity_id": "string",
      "current_state": "string",
      "last_event_name": "string | null",
      "last_event_time": "ISO-8601 | null",
      "last_error_code": "string | null",
      "suggested_action": "string"
    }
  ],
  "count": 0
}
```

## Timeline Response Shape

```json
{
  "order_id": "order_123",
  "timeline": [
    {
      "id": "bev_123",
      "name": "event.name",
      "created_at": "ISO-8601",
      "correlation_id": "corr-id",
      "payload": {},
      "entity_refs": [],
      "actor": { "type": "system" },
      "schema_version": "v1"
    }
  ],
  "count": 0
}
```

## Threshold Configuration

Used by attention endpoints:

- `OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES` (default: `30`)
- `OPS_COD_CAPTURE_PENDING_THRESHOLD_DAYS` (default: `3`)
- `OPS_RETURNS_QC_STUCK_THRESHOLD_DAYS` (default: `2`)
