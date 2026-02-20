# Payments Error Testing Matrix

This matrix is the explicit resilience checklist for the pluggable payments foundation.

## Scenarios

| Scenario | Expected | Test Coverage |
| --- | --- | --- |
| Wrong webhook signature | `401` + `SIGNATURE_INVALID` (or provider-specific equivalent) with `correlation_id` | `src/api/webhooks/payments/__tests__/route.unit.spec.tsx` (`rejects invalid signature with 401 and correlation id`) |
| Duplicate webhook event | First delivery processed, second deduped and ignored | `src/api/webhooks/payments/__tests__/route.unit.spec.tsx` (`dedupes repeated events and ignores second delivery`) |
| Provider `429` on status fetch | Retries and then succeeds when upstream recovers | `src/modules/payment-razorpay/__tests__/service.unit.spec.tsx` (`retries on 429 for status fetch and succeeds within max retries`) |
| Provider `429` on booking/create | No retry, fails fast with `RAZORPAY_RATE_LIMIT` | `src/modules/payment-razorpay/__tests__/service.unit.spec.tsx` (`does not retry on 429 for order creation (booking path)`) |
| Provider `429` on capture | No retry, fails fast with `RAZORPAY_RATE_LIMIT` | `src/modules/payment-razorpay/__tests__/service.unit.spec.tsx` (`does not retry on 429 for capture path`) |
| Tampered authorize signature | `SIGNATURE_INVALID` and payment not marked paid | `src/modules/payment-razorpay/__tests__/service.unit.spec.tsx` (`returns SIGNATURE_INVALID on checkout signature mismatch`) |
| Illegal state transition | `STATE_TRANSITION_INVALID` with `correlation_id` | `src/modules/payments-core/__tests__/state-machine.unit.spec.ts` (`throws STATE_TRANSITION_INVALID with correlation_id on illegal transitions`) |
| Provider down | `PROVIDER_UNAVAILABLE` with `correlation_id` | `src/modules/payments-core/__tests__/reconciliation.unit.spec.ts` (`throws PROVIDER_UNAVAILABLE and does not regress state when provider status fetch fails`) |
| Reconcile job under provider downtime | Job surfaces provider error without mutating payment state | `src/jobs/__tests__/payment-reconciliation.unit.spec.ts` (`surfaces provider downtime gracefully with correlation_id`) |

## Run

```bash
yarn test:unit -- \
  src/api/webhooks/payments/__tests__/route.unit.spec.tsx \
  src/modules/payment-razorpay/__tests__/service.unit.spec.tsx \
  src/modules/payments-core/__tests__/state-machine.unit.spec.ts \
  src/modules/payments-core/__tests__/reconciliation.unit.spec.ts \
  src/jobs/__tests__/payment-reconciliation.unit.spec.ts
```
