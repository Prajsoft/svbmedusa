# Business Events V1

This document defines the business-event contract used by the SVB Medusa backend.

## Storage

Business events are persisted in the `business_event` store (custom observability module) with:

- `id`
- `name`
- `payload` (JSON)
- `correlation_id`
- `created_at`
- `entity_refs` (JSON array, for example `[{ type: "order", id: "order_123" }]`)
- `actor` (JSON, for example `{ type: "admin", id: "user_1" }`)
- `schema_version`

## Emit API

`emitBusinessEvent(name, payload, meta)` where `meta` includes:

- `correlation_id` (required for traceability)
- `actor` (optional, `admin | customer | system`)
- `entity_refs` (optional)

Before emitting on the Medusa event bus, the event is persisted with schema metadata.

## Canonical Event Names (V1)

Core names used in current workflows:

- `order.placed`
- `fulfillment.requested`
- `cod.authorized`
- `return.requested`
- `promotion.applied`

Other operational/audit events can exist, but new events should follow `<domain>.<action>`.

## Timeline Queries

Query helpers:

- `getAuditTimelineForOrder(orderId, { scope })`
- `getAuditTimelineForReturn(returnId, { scope })`

Both return events ordered by `created_at` ascending.

## Schema Versioning Rules

- Default `schema_version` is `v1`.
- Additive payload changes are allowed within `v1`.
- Breaking payload changes require a new schema version (for example `v2`).
- Consumers must branch by `schema_version` when fields are not guaranteed across versions.
