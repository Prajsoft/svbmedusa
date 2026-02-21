# Shiprocket Provider (SVB)

## Overview

This document describes the Shiprocket adapter as implemented behind the provider-agnostic shipping contract.

Primary route:
- `POST /webhooks/shipping/shiprocket`

## API User Creation (Shiprocket Dashboard)

1. Open Shiprocket seller dashboard.
2. Go to `Settings` -> `API`.
3. Click `Add New API User`.
4. Create API credentials for backend use only.
5. Configure backend env:
   - `SHIPROCKET_SELLER_EMAIL`
   - `SHIPROCKET_SELLER_PASSWORD`
   - `SHIPROCKET_BASE_URL` (default `https://apiv2.shiprocket.in/v1/external`)

## Authentication Strategy

- Uses Bearer token authentication.
- Token is cached in-memory with `expires_at`.
- Refresh strategy:
  - proactive refresh before expiry using `SHIPROCKET_TOKEN_REFRESH_SKEW_MINUTES`
  - retry once with token refresh on upstream `401`
- TTL:
  - use upstream TTL if returned
  - fallback to `SHIPROCKET_TOKEN_TTL_HOURS` (conservative expiry window)

## Quote Flow (2-Step Required)

Quote is intentionally two-step:

1. Serviceability check:
   - checks if courier/service is available for pickup/delivery pin codes and parcel profile.
2. Rate calculator:
   - only runs after serviceability success.
   - normalizes rate options into provider-agnostic quote DTO.

## Booking Flow (Forward Shipment)

Booking endpoint:
- `POST /shipments/create/forward-shipment`

Rules:
- `order_id` sent to Shiprocket is our `internal_reference` for idempotency/recovery.
- Kill switch:
  - `SHIPPING_BOOKING_ENABLED=false` blocks booking before any outbound API call.
- Two-phase behavior:
  - create internal shipment with `BOOKING_IN_PROGRESS`
  - call Shiprocket
  - persist `provider_order_id`, `provider_shipment_id`, `provider_awb`, label metadata

## Webhook Security Policy

Webhook header requirement:
- `anx-api-key` must match `SHIPROCKET_WEBHOOK_TOKEN`.
- This is the active verification path used by `POST /webhooks/shipping/shiprocket`.

Default:
- reject unverified webhook with `401` (`SIGNATURE_INVALID` error envelope).

Override:
- `ALLOW_UNSIGNED_WEBHOOKS=true` accepts unverified webhook but logs `WEBHOOK_SECURITY_DEGRADED` and marks payload security mode as degraded.

HMAC note:
- `SHIPROCKET_WEBHOOK_SECRET` + `SHIPROCKET_WEBHOOK_SIGNATURE_HEADER` are used by provider-level `verifyWebhook(...)`.
- The current webhook route already verifies `anx-api-key` and then passes `verify_signature: () => true` to the shared pipeline, so operators should treat `SHIPROCKET_WEBHOOK_TOKEN` as the mandatory runtime control.

## Status Mapping (Shiprocket -> Normalized)

| Shiprocket signal | Normalized `ShipmentStatus` |
|---|---|
| NEW / booked | `BOOKED` |
| pickup scheduled / assigned | `PICKUP_SCHEDULED` |
| in transit / shipped | `IN_TRANSIT` |
| out for delivery | `OFD` |
| delivered | `DELIVERED` |
| cancelled | `CANCELLED` |
| RTO initiated | `RTO_INITIATED` |
| RTO in transit | `RTO_IN_TRANSIT` |
| RTO delivered | `RTO_DELIVERED` |
| failure/undelivered/exception | `FAILED` |

## Error Mapping (Shiprocket -> ProviderErrorCode)

| Upstream pattern | Normalized code |
|---|---|
| 401/403 | `AUTH_FAILED` |
| 429 | `RATE_LIMITED` |
| serviceability/pincode validation | `SERVICEABILITY_FAILED` |
| invalid address | `INVALID_ADDRESS` |
| not cancellable/already shipped | `CANNOT_CANCEL_IN_STATE` |
| 5xx/network outage | `PROVIDER_UNAVAILABLE` |
| unknown upstream failure | `UPSTREAM_ERROR` |

## Label Expiry Strategy

- Label is served via internal endpoint `GET /shipments/:id/label` (admin-authenticated).
- Stored fields include:
  - `label_url`
  - `label_generated_at`
  - `label_expires_at`
  - `label_last_fetched_at`
  - `label_status`
- On expired/missing label:
  - regenerate/refresh from provider
  - persist refreshed metadata
- UI should never use stale stored URL directly.

## WIP Safety Flags

- `SHIPPING_BOOKING_ENABLED`:
  - `false` in WIP rollout to prevent real order booking while integration is validated.
- `SHIPPING_PROVIDER_DEFAULT=shiprocket`:
  - enable only after credentials + webhook policy + QA checks are complete.

## Multi-Account Note

Current assumption:
- single seller account (single Shiprocket credential set).

Future extension:
- token cache keyed by `seller_id`
- credentials stored in secure secret manager per seller/account
- routing/booking chooses seller context explicitly (not global process env)
