# Adding a Payment Provider

Use this checklist to add a new provider without breaking the foundation.

## 1. Implement Provider Adapter

Create provider implementation that conforms to:

- `payments/provider/IPaymentProvider.ts`

Implement methods:

- `initiatePayment`
- `authorizePayment`
- `capturePayment`
- `refundPayment`
- `cancelPayment`
- `getCapabilities`

Rules:

- return canonical `PaymentStatus` only
- map provider failures to canonical `PaymentErrorCode`
- include `correlation_id` in every error result

## 2. Register and Route Provider

Wire provider in Medusa config and router layer:

- add provider registration in `medusa-config.ts`
- ensure router can resolve provider id:
  - default: `PAYMENT_PROVIDER_DEFAULT`
  - existing session: `payment_session.provider_id`
- keep kill switch behavior (`PAYMENTS_ENABLED`)

## 3. Add Presentation Data Builder

If provider requires client-side handoff data:

- extend `src/modules/payments-core/presentation-data.ts`
- add union type in `payments/types.ts` (if new shape needed)

Frontend contract must consume only safe `presentation_data` fields.

## 4. Webhook Verifier + Mapper

Extend shared webhook pipeline:

- `src/modules/payments-core/webhook-pipeline.ts`
- `src/modules/payments-core/webhook-provider-registry.ts`

Add:

- signature verification logic
- raw event to internal `PaymentEvent` mapping
- provider-specific refs extraction

Do not bypass:

- dedupe insert
- shared state machine transition
- standard error envelope

## 5. Reconciliation Support

Ensure stuck-session reconciliation can read provider status and move states forward:

- `src/modules/payments-core/reconciliation.ts`
- job wrapper: `src/jobs/payment-reconciliation.ts`

## 6. Observability

Use shared observability helpers everywhere:

- `logProviderCall`
- `logWebhookEvent`
- `logReconcileRun`

Include:

- `correlation_id`
- provider id
- method/event context

## 7. Tests (Required)

Contract tests:

- run `payments/tests/providerContractSuite.ts` against new provider

Required test coverage:

- initiate idempotency
- authorize idempotency
- canonical error mapping (no raw upstream leakage)
- webhook signature rejection path
- webhook dedupe behavior
- transition correctness through state machine
- reconciliation progression/no-regression behavior

Current examples:

- `src/modules/payment-razorpay/__tests__/provider-contract-suite.unit.spec.tsx`
- `src/api/webhooks/payments/__tests__/route.unit.spec.tsx`
- `src/modules/payments-core/__tests__/reconciliation.unit.spec.ts`

## 8. Documentation Update (Required)

Update these docs in same PR:

- `docs/payments/overview.md`
- `docs/payments/webhooks.md`
- `docs/payments/observability.md`
- `docs/payments/reconciliation.md`
- provider-specific doc (for example `docs/payments/razorpay.md`)

## Definition of Done

- provider passes contract suite
- webhook path uses shared verifier/mapper/dedupe/state machine
- presentation data path is safe and provider-agnostic
- reconciliation works with no state regression
- docs and README links are updated
