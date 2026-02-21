# Shipping QA Runbook v1

## Purpose

Operational and QA checks for the pluggable shipping stack.

Coverage focus:
- quote
- booking (two-phase + recovery)
- label lifecycle
- tracking
- webhook ordering/race handling
- retry/circuit-breaker behavior
- logging and correlation IDs

## Preflight

Run from `svb-medusa`:

```bash
yarn install
```

Recommended env for local QA:
- `CARRIER_ADAPTER=fake`
- `SHIPPING_PROVIDER_DEFAULT=fake`
- `SHIPPING_BOOKING_ENABLED=true`
- `ALLOW_UNSIGNED_WEBHOOKS=false` (keep strict by default)

## 1) Quote / Router Retry Checks

Run:

```bash
yarn test:unit -- src/integrations/carriers/__tests__/router.unit.spec.tsx
```

What to verify:
- quote retries on transient errors
- createShipment is not retried by default
- circuit breaker opens after threshold failures
- booking kill-switch (`SHIPPING_BOOKING_ENABLED=false`) blocks booking

## 2) Booking (Two-Phase, Recovery, Provider Switching)

Run:

```bash
yarn test:unit -- src/modules/shipping/__tests__/shipment-booking.unit.spec.tsx
```

What to verify:
- provider success + DB update failure can be recovered
- repeated booking with same reference is idempotent
- DRAFT shipment can be recreated under new provider
- BOOKED+ shipment cannot switch provider

## 3) Label Lifecycle Checks

Run:

```bash
yarn test:unit -- src/modules/shipping/__tests__/shipment-label.unit.spec.tsx
yarn test:unit -- src/api/__tests__/shipment-label-route.unit.spec.tsx
```

What to verify:
- non-expired label returns cached URL
- expired label triggers refresh/regen and DB update
- API route returns stable payload and error envelope

Endpoint to use in manual smoke tests:
- `GET /shipments/:id/label`
- requires authenticated admin actor (`auth_context.actor_id`)

## 4) Tracking and Legacy Provider Routing

Run:

```bash
yarn test:unit -- src/integrations/carriers/__tests__/router.unit.spec.tsx
```

What to verify:
- tracking routes by persisted `shipment.provider`
- when default provider changes, old shipments still route to old provider
- cancel flow also routes by persisted provider for existing shipments

## 5) Simulate Out-of-Order Webhooks

Automated coverage:

```bash
yarn test:unit -- src/modules/shipping/__tests__/shipment-persistence.unit.spec.tsx
yarn test:unit -- src/modules/shipping/__tests__/webhook-pipeline.unit.spec.tsx
yarn test:unit -- src/api/webhooks/shipping/shiprocket/__tests__/route.unit.spec.tsx
```

Manual sequence:
1. Send webhook first for unknown provider shipment ID to `POST /webhooks/shipping/shiprocket`.
2. Confirm response indicates buffered processing (`buffered=true` in route response).
3. Create/reconcile shipment record.
4. Run replay job or call replay path.
5. Confirm buffered event gets attached and status updates.

## 6) Simulate Rate Limiting and Upstream Errors

Automated:

```bash
yarn test:unit -- src/integrations/carriers/__tests__/router.unit.spec.tsx
yarn test:unit -- src/integrations/carriers/__tests__/shiprocket.unit.spec.tsx
```

What to verify:
- `429`/network/`5xx` retries on retryable methods only
- non-retryable methods do not accidentally duplicate bookings
- error mapping normalizes to `ProviderErrorCode`

## 7) Verify Structured Logs + Correlation ID

Expected event:
- `SHIPPING_PROVIDER_CALL`

Required fields:
- `provider`
- `method`
- `duration_ms`
- `success`
- `error_code`
- `correlation_id`
- optional `shipment_id`
- optional `provider_shipment_id`

Quick check:
1. trigger a router flow (quote/track/create)
2. inspect logs for `SHIPPING_PROVIDER_CALL`
3. ensure one event per router call with required fields
4. ensure no PII and no secrets

## 8) Security Verification (Webhooks)

Default:
- reject unverified webhooks

Checks:
1. invalid signature/IP -> expect 401/403 style rejection
2. valid verification -> accepted and processed
3. set `ALLOW_UNSIGNED_WEBHOOKS=true` only for emergency/dev
4. verify degraded mode emits `WEBHOOK_SECURITY_DEGRADED`

## 9) Recommended CI Subset

```bash
yarn test:unit -- src/integrations/carriers/__tests__/provider-contract-dto.unit.spec.tsx
yarn test:unit -- src/integrations/carriers/__tests__/provider-contract-types.unit.spec.tsx
yarn test:unit -- src/integrations/carriers/__tests__/router.unit.spec.tsx
yarn test:unit -- src/integrations/carriers/__tests__/shiprocket.unit.spec.tsx
yarn test:unit -- src/modules/shipping/__tests__/shipment-persistence.unit.spec.tsx
yarn test:unit -- src/modules/shipping/__tests__/shipment-booking.unit.spec.tsx
yarn test:unit -- src/modules/shipping/__tests__/shipment-label.unit.spec.tsx
yarn test:unit -- src/modules/shipping/__tests__/webhook-pipeline.unit.spec.tsx
yarn test:unit -- src/api/webhooks/shipping/shiprocket/__tests__/route.unit.spec.tsx
yarn test:unit -- src/api/__tests__/shipment-label-route.unit.spec.tsx
```

## 10) Exit Checklist

- quote path passes
- booking + recovery path passes
- label refresh path passes
- tracking/cancel routing by persisted provider passes
- webhook out-of-order buffering + replay passes
- rate-limit retry behavior passes
- structured logs include correlation ID and required keys
- no raw PII leaks in persisted webhook/event payloads

## 11) Shiprocket-Specific QA Cases

### 11.1 Quote two-step (serviceability -> rate)

Run:

```bash
yarn test:unit -- src/integrations/carriers/__tests__/shiprocket.unit.spec.tsx
```

Verify:
- serviceability executes first
- rate calculator executes only after serviceability pass

### 11.2 Booking disabled prevents outbound call

Run:

```bash
yarn test:unit -- src/integrations/carriers/__tests__/shiprocket.unit.spec.tsx src/integrations/carriers/__tests__/router.unit.spec.tsx
```

Verify:
- with `SHIPPING_BOOKING_ENABLED=false`, booking fails with `BOOKING_DISABLED`
- no provider HTTP booking call is made

### 11.3 Booking enabled stores provider ids

Run:

```bash
yarn test:unit -- src/integrations/carriers/__tests__/shiprocket.unit.spec.tsx src/modules/shipping/__tests__/shipment-booking.unit.spec.tsx
```

Verify:
- persisted shipment contains `provider_order_id`, `provider_shipment_id`, `provider_awb`
- status transitions from `BOOKING_IN_PROGRESS` to `BOOKED`

### 11.4 Webhook out-of-order buffering/replay

Run:

```bash
yarn test:unit -- src/api/webhooks/shipping/shiprocket/__tests__/route.unit.spec.tsx src/modules/shipping/__tests__/shipment-persistence.unit.spec.tsx
```

Verify:
- unmatched webhook buffered first
- replay later attaches event and updates shipment state

### 11.5 Label expiry refresh

Run:

```bash
yarn test:unit -- src/modules/shipping/__tests__/shipment-label.unit.spec.tsx src/api/__tests__/shipment-label-route.unit.spec.tsx
```

Verify:
- expired label triggers refresh/regeneration path
- DB metadata (`label_expires_at`, `label_status`) updated

### 11.6 Cancel idempotency caveats

Run:

```bash
yarn test:unit -- src/integrations/carriers/__tests__/shiprocket.unit.spec.tsx src/integrations/carriers/__tests__/router.unit.spec.tsx
```

Verify:
- provider message "already cancelled" treated as success
- "not cancellable/already shipped" maps to `CANNOT_CANCEL_IN_STATE`
- repeated cancel is idempotent
