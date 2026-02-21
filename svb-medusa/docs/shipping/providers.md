# Shipping Providers v1 (Pluggable)

## Purpose

This document defines the provider-agnostic shipping architecture used in `svb-medusa`.

Goals:
- switch default providers without breaking existing shipments
- keep provider-specific payloads isolated in adapter files
- persist only normalized shipment state + sanitized event data
- keep webhook ingestion idempotent and race-safe

Provider-specific deep docs:
- `docs/shipping/providers/shiprocket.md`

## Core Contract (Interface, DTOs, Capabilities)

Code source:
- `src/integrations/carriers/provider-contract.ts`

### Provider interface

Every provider implements:
- `quote(input)`
- `createShipment(input)` (must accept `internal_reference` + `idempotency_key`)
- `getLabel(input)` (must handle expiry/regen)
- `track(input)`
- `cancel(input)`
- `healthCheck()`
- optional `findShipmentByReference(input)`
- optional `verifyWebhook(request)`

### DTOs

Provider contract DTOs:
- `Address`
- `Parcel`
- `LineItem`
- `QuoteRequest` / `QuoteResponse`
- `CreateShipmentRequest` / `CreateShipmentResponse`
- `GetLabelRequest` / `LabelResponse`
- `TrackRequest` / `TrackingResponse`
- `CancelRequest` / `CancelResponse`
- `HealthCheckResponse`
- `LookupShipmentByReferenceRequest`

### Normalized enums

- `ShipmentStatus`:
  `DRAFT`, `BOOKING_IN_PROGRESS`, `BOOKED`, `PICKUP_SCHEDULED`, `IN_TRANSIT`, `OFD`, `DELIVERED`, `FAILED`, `CANCELLED`, `RTO_INITIATED`, `RTO_IN_TRANSIT`, `RTO_DELIVERED`
- `ProviderErrorCode`:
  `AUTH_FAILED`, `SERVICEABILITY_FAILED`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `INVALID_ADDRESS`, `BOOKING_DISABLED`, `CANNOT_CANCEL_IN_STATE`, `NOT_SUPPORTED`, `SIGNATURE_INVALID`, `PROVIDER_UNAVAILABLE`

### Capabilities matrix

Contract flags:
- `supports_cod`
- `supports_reverse`
- `supports_label_regen`
- `supports_webhooks`
- `supports_cancel`
- `supports_multi_piece`
- `supports_idempotency`
- `supports_reference_lookup`

## Router Model (Single Entry Point)

Code source:
- `src/integrations/carriers/router.ts`
- `src/integrations/carriers/index.ts`

Rules:
- all provider calls go through `ShippingProviderRouter`
- provider selection for new bookings comes from `SHIPPING_PROVIDER_DEFAULT`
- existing shipment operations route by persisted shipment provider (`shipment.provider`)
- create-shipment kill switch blocks booking when `SHIPPING_BOOKING_ENABLED=false`

## Persistence Model (Provider-Agnostic)

Code source:
- `src/modules/shipping/shipment-persistence.ts`

Tables:
- `shipping_shipments`
- `shipping_events`
- `shipping_webhook_buffer`

Important constraints and indexes:
- unique: `shipping_shipments.internal_reference`
- partial unique index:
  `uq_shipping_shipments_active_order_provider` on `(order_id, provider)` where `is_active=true`
- index: `(provider, provider_shipment_id)`
- index: `(provider, provider_awb)`
- unique dedupe index:
  `uq_shipping_events_provider_event_id` on `(provider, provider_event_id)` when not null
- buffer dedupe unique: `(provider, provider_event_id)`

Rebooking model:
- new booking record can point to `replacement_of_shipment_id`
- old active shipment is marked inactive
- at most one active shipment per `(order_id, provider)`

## Provider Switching Behavior

Code source:
- `src/modules/shipping/shipment-booking.ts`
- `src/integrations/carriers/router.ts`

Rules:
- new shipments use current `SHIPPING_PROVIDER_DEFAULT`
- existing shipment operations use `shipment.provider` (track/cancel route by stored provider)
- if same internal reference exists with different provider:
  - `DRAFT`: old record can be marked inactive and booking recreated under new provider
  - `BOOKED` or later: switch is blocked with `INTERNAL_REFERENCE_PROVIDER_CONFLICT`

## Two-Phase Booking + Recovery

Code source:
- `src/modules/shipping/shipment-booking.ts`
- `src/jobs/shipping-booking-recovery.ts`

Flow:
1. create internal shipment (`BOOKING_IN_PROGRESS`) with `internal_reference`
2. call provider create-shipment
3. update internal shipment to booked state with provider IDs/AWB/label metadata

Recovery:
- if provider booking succeeds but DB update fails, record is recoverable
- recovery job looks up by `internal_reference` and repairs record

## PII Sanitization + Retention

Code source:
- `src/modules/shipping/sanitize-provider-payload.ts`
- `src/modules/shipping/events-retention.ts`
- `src/jobs/shipping-events-payload-retention.ts`

Policy:
- sanitize before persistence
- strip recipient PII fields (name, phone, email, address lines, landmark, free-form notes)
- retain operational fields (city/state/pincode, carrier IDs, AWB, status, timestamps, error codes)

Retention:
- `shipping_events` rows are retained
- `raw_payload_sanitized` is scrubbed by TTL (`SHIPPING_EVENTS_PAYLOAD_TTL_DAYS`, default 90)
- retention job schedule env: `SHIPPING_EVENTS_PAYLOAD_RETENTION_CRON`

## Webhook Pipeline (Dedupe + Buffer + Replay)

Code source:
- `src/modules/shipping/webhook-pipeline.ts`
- `src/modules/shipping/shipment-persistence.ts`
- `src/modules/shipping/webhook-replay.ts`
- `src/jobs/shipping-webhook-buffer-replay.ts`

Behavior:
- verify webhook first (reject invalid by default)
- dedupe by `(provider, provider_event_id)`
- match shipment by `(provider, provider_shipment_id)` or `(provider, provider_awb)`
- if unmatched, buffer event in `shipping_webhook_buffer`
- replay buffer later via job (`SHIPPING_WEBHOOK_REPLAY_CRON`)

## Retry Policy + Circuit Breaker

Code source:
- `src/integrations/carriers/router.ts`

Retryable methods:
- `quote`
- `lookupShipmentByReference`
- `track`
- `getLabel`
- `healthCheck`

Not retryable by default:
- `createShipment`
- `cancel`

Config env vars:
- `SHIPPING_ROUTER_RETRY_MAX_ATTEMPTS`
- `SHIPPING_ROUTER_RETRY_BASE_MS`
- `SHIPPING_ROUTER_RETRY_JITTER_MS`
- `SHIPPING_ROUTER_BREAKER_CONSECUTIVE_FAILURES`
- `SHIPPING_ROUTER_BREAKER_ERROR_RATE_PERCENT`
- `SHIPPING_ROUTER_BREAKER_WINDOW_SIZE`
- `SHIPPING_ROUTER_BREAKER_OPEN_MS`

## Webhook Security Policy

Code source:
- `src/modules/shipping/webhook-security-policy.ts`
- `src/api/webhooks/shipping/shiprocket/route.ts`
- `src/integrations/carriers/shiprocket.ts`

Default behavior:
- unsigned/unverified webhooks are rejected
- override exists only via `ALLOW_UNSIGNED_WEBHOOKS=true`
- degraded mode is logged as `WEBHOOK_SECURITY_DEGRADED`

Shiprocket verification inputs:
- `SHIPROCKET_WEBHOOK_TOKEN`
- header: `anx-api-key`

## Label Lifecycle

Code source:
- `src/modules/shipping/shipment-label.ts`
- `src/api/shipments/[id]/label/route.ts`

Stored fields:
- `label_url`
- `label_generated_at`
- `label_expires_at`
- `label_last_fetched_at`
- `label_status` (`AVAILABLE`, `EXPIRED`, `MISSING`, `REGEN_REQUIRED`)

Access pattern:
- always call internal endpoint `GET /shipments/:id/label`
- do not use stale stored URL directly from UI
- endpoint refreshes/regenerates as needed
- endpoint requires authenticated admin actor (`auth_context.actor_id`)

## Endpoints and Jobs

### HTTP endpoints

- `POST /webhooks/shipping/shiprocket`
- `GET /shipments/:id/label`

### Scheduled jobs

- `shipping-booking-recovery` (`SHIPPING_BOOKING_RECOVERY_CRON`)
- `shipping-webhook-replay` (`SHIPPING_WEBHOOK_REPLAY_CRON`)
- `shipping-events-payload-purge` (`SHIPPING_EVENTS_PAYLOAD_PURGE_CRON`)

## Environment Variables (Actual)

Provider selection and router:
- `CARRIER_ADAPTER` (`fake` in dev by default, `shiprocket` in prod when configured)
- `SHIPPING_PROVIDER_DEFAULT`
- `SHIPPING_BOOKING_ENABLED`
- `SHIPPING_ROUTER_RETRY_MAX_ATTEMPTS`
- `SHIPPING_ROUTER_RETRY_BASE_MS`
- `SHIPPING_ROUTER_RETRY_JITTER_MS`
- `SHIPPING_ROUTER_BREAKER_CONSECUTIVE_FAILURES`
- `SHIPPING_ROUTER_BREAKER_ERROR_RATE_PERCENT`
- `SHIPPING_ROUTER_BREAKER_WINDOW_SIZE`
- `SHIPPING_ROUTER_BREAKER_OPEN_MS`

Booking recovery and replay:
- `SHIPPING_BOOKING_RECOVERY_OLDER_THAN_MINUTES`
- `SHIPPING_BOOKING_RECOVERY_LIMIT`
- `SHIPPING_BOOKING_RECOVERY_CRON`
- `SHIPPING_WEBHOOK_REPLAY_BATCH_SIZE`
- `SHIPPING_WEBHOOK_REPLAY_CRON`

Retention:
- `SHIPPING_EVENTS_PAYLOAD_TTL_DAYS`
- `SHIPPING_EVENTS_PAYLOAD_PURGE_CRON`

Webhook security:
- `SHIPROCKET_WEBHOOK_TOKEN` (route-level `anx-api-key` verification)
- `ALLOW_UNSIGNED_WEBHOOKS` (default false)
- `SHIPROCKET_WEBHOOK_SECRET` (HMAC verification for direct provider `verifyWebhook` usage)
- `SHIPROCKET_WEBHOOK_IP_ALLOWLIST` (optional, only for HMAC/IP flow)
- `SHIPROCKET_WEBHOOK_SIGNATURE_HEADER` (optional override for HMAC/IP flow)

Shiprocket provider auth/base URL:
- `SHIPROCKET_TOKEN` or `SHIPROCKET_SELLER_EMAIL` + `SHIPROCKET_SELLER_PASSWORD`
- fallback aliases: `SHIPROCKET_EMAIL` + `SHIPROCKET_PASSWORD`
- `SHIPROCKET_BASE_URL` (fallback alias: `SHIPROCKET_API_BASE_URL`)
- `SHIPROCKET_LABEL_TTL_HOURS`

## Provider Switch Playbook

Use case: move default for new bookings from provider A to provider B.

Steps:
1. Keep existing shipments untouched.
2. Set `SHIPPING_PROVIDER_DEFAULT` to new provider.
3. Keep old provider adapter configured until legacy shipments finish.
4. Validate new bookings route to new provider.
5. Validate track/cancel still route legacy shipments to old provider.
6. For DRAFT-only entries requiring migration, recreate under new provider and mark old inactive.
7. Do not force-migrate `BOOKED+` shipments.
8. Monitor `SHIPPING_PROVIDER_CALL` error rates for both providers.
9. Keep webhook routes active for both providers during transition.
10. Decommission old provider only after no active legacy shipments remain.

### Rollback steps

1. Set `SHIPPING_PROVIDER_DEFAULT` back to previous provider.
2. Keep both adapters active; do not delete old credentials immediately.
3. Confirm new bookings now use previous provider.
4. Confirm old shipments still track/cancel correctly.
5. Review webhook buffer backlog and replay status.

## Add New Provider in 10 Steps

1. Create adapter file under `src/integrations/carriers/<provider>.ts`.
2. Implement full `ShippingProvider` interface from `provider-contract.ts`.
3. Map provider statuses to normalized `ShipmentStatus`.
4. Map provider failures to normalized `ProviderErrorCode`.
5. Route all raw payload persistence through `sanitizeProviderPayload(...)`.
6. Add provider entry to `src/integrations/carriers/index.ts`.
7. Add adapter unit tests for quote/create/getLabel/track/cancel/health/verifyWebhook.
8. Add webhook route `src/api/webhooks/shipping/<provider>/route.ts` using shared pipeline.
9. Verify router behavior with default-provider switch and legacy shipment routing.
10. Update this doc + `docs/shipping/qa-runbook.md` and ship with rollout plan.
