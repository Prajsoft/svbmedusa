# Pluggable Payments Foundation (v1)

## Purpose

Define a single backend contract for all payment providers so providers can be added/replaced without changing core checkout invariants.

## Non-Negotiables

- No secrets in frontend bundles or logs.
- One internal language for payments:
  - `PaymentStatus` (`PENDING`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `CANCELED`, `REFUNDED`)
  - `PaymentProviderError` and standard error envelope:
    - `{ "error": { "code", "message", "details", "correlation_id" } }`
- Every state change goes through shared state machine and must be idempotent.
- Webhooks are verified-or-rejected by default; opt-out only via explicit flag.
- Structured observability for provider calls and webhook paths.
- Reconciliation job required for stale/stuck sessions.

## Core Module

Location: `src/modules/payments-core/`

Canonical language types: `payments/types.ts`

Provider contract and DTO validation: `payments/provider/`
Provider contract test harness: `payments/tests/providerContractSuite.ts`
Standardized payment observability helpers: `payments/observability.ts`

- `contracts.ts`
  - Shared statuses/error codes.
  - `PaymentProviderError`.
  - `toPaymentErrorEnvelope(...)`.
- `state-machine.ts`
  - Allowed transitions and idempotent transition behavior.
- `webhook-policy.ts`
  - `PAYMENTS_ALLOW_UNVERIFIED_WEBHOOKS` policy gate.
- `observability.ts`
  - `logPaymentProviderEvent(...)` for structured provider/webhook logs.
- `reconciliation.ts`
  - Stuck payment reconciliation scan/update logic.

## Provider Contract (Prompt 3)

Files:

- `payments/provider/IPaymentProvider.ts`
  - `IPaymentProvider` methods:
    - `initiatePayment`
    - `authorizePayment`
    - `capturePayment`
    - `refundPayment`
    - `cancelPayment`
    - `getCapabilities`
  - Strict DTOs via `zod`:
    - `initiatePaymentInputSchema`
    - `initiatePaymentOutputSchema`
    - `authorizePaymentInputSchema`
  - Provider result contract:
    - success returns canonical `PaymentStatus`
    - failures return canonical `PaymentErrorCode` only
    - `NOT_SUPPORTED` helper for unsupported provider capabilities
- `payments/provider/capabilities.ts`
  - `PAYMENT_PROVIDER_CAPABILITIES` matrix
  - `getProviderCapabilities(provider)`
- `payments/tests/providerContractSuite.ts`
  - reusable provider contract harness
  - validates status/output DTOs, mapped errors, capabilities, and idempotency behavior

## Provider Router (Prompt 4)

File:

- `src/modules/payments-core/provider-router.ts`
  - `getDefaultProvider()` selects from `PAYMENT_PROVIDER_DEFAULT` (fallback `razorpay`)
  - `getProviderById(id)` resolves explicit provider IDs
  - `getProviderForPaymentSession({ payment_session_id })` loads `payment_session.provider_id` and routes by stored provider (not by current default)
  - kill switch: `PAYMENTS_ENABLED=false` fails fast with `PROVIDER_UNAVAILABLE`
  - emits structured selection event:
    - `PAYMENT_PROVIDER_SELECTED`
    - payload includes `provider`, `payment_session_id`, `correlation_id`

## Observability Standard (Prompt 5)

File:

- `payments/observability.ts`
  - `logProviderCall({ provider, method, duration_ms, success, error_code, correlation_id, payment_id?, payment_session_id? })`
  - `logWebhookEvent({ provider, event_type, event_id, matched, deduped, success, correlation_id })`
  - `logReconcileRun({ provider, checked_count, updated_count, success, correlation_id })`

Behavior:

- Emits strict structured events:
  - `PAYMENT_PROVIDER_CALL`
  - `PAYMENT_WEBHOOK_EVENT`
  - `PAYMENT_RECONCILE_RUN`
- Adds baseline metrics hooks:
  - `payments.provider.call.total`
  - `payments.provider.call.duration_ms`
  - `payments.webhook.event.total`
  - `payments.reconcile.run.total`
- Avoids secret/PII logging by design:
  - helper payloads only include safe allowlisted fields
  - log pipeline redaction still applies as a secondary control

## Shared Webhook Pipeline (Prompt 6)

Infrastructure:

- Dedupe table repository: `src/modules/payments-core/payment-webhook-event-repository.ts`
  - table: `payment_webhook_events`
  - columns: `provider`, `event_id`, `received_at`
  - unique key: `(provider, event_id)`
- Pipeline engine: `src/modules/payments-core/webhook-pipeline.ts`
  - provider-specific verification + mapping to internal `PaymentEvent`
  - dedupe insert with conflict-noop behavior
  - status transition via shared state machine
  - payment session persistence with provider refs

Route:

- `POST /webhooks/payments/:provider`
  - file: `src/api/webhooks/payments/[provider]/route.ts`
  - returns `200` quickly on duplicates
  - default policy rejects unsigned/unverifiable webhooks
  - explicit override: `ALLOW_UNSIGNED_WEBHOOKS=true`

Shared route behavior:

- Invalid signatures return `401` with standard error envelope.
- Invalid mappings return `VALIDATION_ERROR` with `correlation_id`.
- Transition application is idempotent and reconciles to canonical payment status.

## Razorpay Compliance

Razorpay provider (`src/modules/payment-razorpay/service.ts`) now uses the foundation:

- Provider status changes go through shared state machine (`transitionPaymentStatus`).
- Provider/API calls log structured:
  - `PAYMENT_PROVIDER_CALL_ATTEMPT`
  - `PAYMENT_PROVIDER_CALL_SUCCESS`
  - `PAYMENT_PROVIDER_CALL_FAIL`
- Pluggable contract adapter is implemented in:
  - `src/modules/payment-razorpay/contract-provider.ts`
  - adapter maps provider outputs/errors to canonical `PaymentStatus` and `PaymentErrorCode`
- Webhook verification uses shared policy:
  - default: reject unverified
  - override: `PAYMENTS_ALLOW_UNVERIFIED_WEBHOOKS=true`
- Session data carries canonical `payment_status` plus provider status (`razorpay_payment_status`).

Webhook routing:

- Canonical route: `POST /webhooks/payments/:provider`
- Razorpay compatibility route: `POST /webhooks/razorpay`
  - implemented as a thin delegate that sets `provider=razorpay` and calls the shared webhook pipeline.

## Reconciliation Job

Job file: `src/jobs/payment-reconciliation.ts`

- Schedule: `PAYMENTS_RECONCILIATION_CRON` (default `*/20 * * * *`).
- Staleness threshold: `PAYMENTS_RECONCILIATION_STUCK_MINUTES` (default `30`).
- Per-run cap: `PAYMENTS_RECONCILIATION_MAX_SESSIONS` (default `200`).
- Emits structured events:
  - `PAYMENT_RECONCILIATION_SCAN_STARTED`
  - `PAYMENT_RECONCILIATION_SESSION_RECONCILED`
  - `PAYMENT_RECONCILIATION_SCAN_COMPLETED`
  - `PAYMENT_RECONCILIATION_SCAN_FAILED`

## Provider Extension Rules

When adding provider `X`:

1. Keep provider secrets backend-only.
2. Use `payment_status` as canonical session field and provider-specific status as secondary field.
3. Use shared transition helper for every status mutation.
4. Verify webhooks by default; support explicit override only through shared webhook policy.
5. Emit structured provider and webhook events via shared observability helper.
6. Add provider-specific reconciliation metadata mapping if needed.
7. Add tests for:
   - status transition idempotency
   - signature verification failures
   - standardized error envelope
   - webhook duplicate handling
   - reconciliation behavior

## Current Test Coverage

- `src/modules/payments-core/__tests__/contracts.unit.spec.ts`
- `src/modules/payments-core/__tests__/state-machine.unit.spec.ts`
- `src/modules/payments-core/__tests__/types-compile.unit.spec.ts`
- `src/modules/payments-core/__tests__/webhook-policy.unit.spec.ts`
- `src/modules/payments-core/__tests__/reconciliation.unit.spec.ts`
- `src/modules/payments-core/__tests__/provider-contract.unit.spec.ts`
- `src/modules/payment-razorpay/__tests__/provider-contract-suite.unit.spec.tsx`
- `src/modules/payments-core/__tests__/provider-router.unit.spec.ts`
- `src/modules/payments-core/__tests__/payments-observability.unit.spec.ts`
- `src/modules/payments-core/__tests__/payment-webhook-event-repository.unit.spec.ts`
- `src/modules/payment-razorpay/__tests__/service.unit.spec.tsx`
- `src/api/webhooks/razorpay/__tests__/route.unit.spec.tsx`
- `src/api/webhooks/payments/__tests__/route.unit.spec.tsx`
- `src/jobs/__tests__/payment-reconciliation.unit.spec.ts`

State machine specification document:

- `docs/payments/state-machine.md`
