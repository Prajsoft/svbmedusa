# Razorpay WIP QA Runbook

This runbook validates Razorpay TEST-mode checkout end-to-end for the current Medusa + Next.js integration.

## Preconditions

- Backend is running with:
  - `ENABLE_RAZORPAY=true`
  - `PAYMENTS_MODE=test`
  - `RAZORPAY_KEY_ID=rzp_test_...`
  - `RAZORPAY_KEY_SECRET=...`
  - `RAZORPAY_WEBHOOK_SECRET=...`
- Storefront is pointed to this backend.
- You can complete a checkout cart in the storefront.
- You have Postman and (for debug endpoint checks) an admin auth token.

Suggested Postman environment vars:

- `BACKEND_URL` (example: `https://bknd-svb.svbsports.com`)
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `CART_ID`
- `PAYMENT_COLLECTION_ID`
- `ORDER_ID`
- `ADMIN_BEARER_TOKEN`

## 1) Postman Smoke: Razorpay API Credential Check

1. In Postman, create request:
   - Method: `GET`
   - URL: `https://api.razorpay.com/v1/payments`
2. Auth tab:
   - Type: `Basic Auth`
   - Username: `{{RAZORPAY_KEY_ID}}`
   - Password: `{{RAZORPAY_KEY_SECRET}}`
3. Send.

Expected:

- HTTP `200`
- Response contains payments list payload (possibly empty list, but auth is valid).

## 2) Happy Path: Cart -> Razorpay -> Paid

1. On storefront, create/fill cart and reach checkout.
2. Select Razorpay payment method.
3. Click `Place order`.
4. Razorpay popup opens. Complete payment with Razorpay TEST instrument.
5. Storefront should complete order flow and land on order confirmation.

Expected:

- Order is paid/captured in admin/order view.
- Logs include:
  - `RAZORPAY_ORDER_CREATED`
  - `RAZORPAY_CHECKOUT_INITIATED`
  - `RAZORPAY_SIGNATURE_OK`
- Optional metadata verification (admin-only):
  - `GET {{BACKEND_URL}}/admin/ops/debug/razorpay-payment?order_id={{ORDER_ID}}`
  - Header: `Authorization: Bearer {{ADMIN_BEARER_TOKEN}}`
  - Response includes `razorpay_order_id`, `razorpay_payment_id`, `razorpay_payment_status` in session metadata.

## 3) Close Tab After Paying: Webhook Reconciliation

1. Start checkout and open Razorpay popup.
2. Complete payment in popup.
3. Close storefront tab before frontend completes redirect/confirmation.
4. Ensure webhook reaches backend endpoint:
   - `POST {{BACKEND_URL}}/webhooks/razorpay`
   - If needed, retry from Razorpay dashboard webhook deliveries.

Expected:

- Webhook delivery succeeds (2xx).
- Backend logs include:
  - `RAZORPAY_WEBHOOK_RECEIVED`
  - `RAZORPAY_WEBHOOK_OK`
  - `RAZORPAY_WEBHOOK_PROCESSED`
- Order eventually becomes paid/captured even though tab was closed.

## 4) Failure Tests

### A) Tampered Signature -> `SIGNATURE_INVALID`

Use Postman to authorize with a wrong signature against payment session init endpoint.

1. Prepare cart with Razorpay session (from normal checkout initiation).
2. Call:
   - Method: `POST`
   - URL: `{{BACKEND_URL}}/store/payment-collections/{{PAYMENT_COLLECTION_ID}}/payment-sessions`
   - Headers:
     - `Content-Type: application/json`
     - `x-correlation-id: qa-signature-tamper-001` (optional, recommended)
   - Body:

```json
{
  "provider_id": "pp_razorpay_razorpay",
  "data": {
    "razorpay_payment_id": "pay_fake_001",
    "razorpay_order_id": "order_fake_001",
    "razorpay_signature": "tampered_signature",
    "internal_reference": "{{CART_ID}}",
    "cart_id": "{{CART_ID}}"
  }
}
```

Expected:

- Error JSON code `SIGNATURE_INVALID`
- Error envelope includes `correlation_id`
- Response header includes `x-correlation-id`

### B) Invalid Webhook Signature -> Rejected

1. Call:
   - Method: `POST`
   - URL: `{{BACKEND_URL}}/webhooks/razorpay`
   - Headers:
     - `Content-Type: application/json`
     - `x-razorpay-signature: invalid_signature`
     - `x-razorpay-event-id: evt_invalid_sig_001`
   - Body:

```json
{
  "event": "payment.authorized",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_test_invalid_001",
        "order_id": "order_test_invalid_001",
        "amount": 100,
        "currency": "INR",
        "notes": {
          "session_id": "payses_test_invalid_001"
        }
      }
    }
  }
}
```

Expected:

- HTTP `401`
- Error JSON code `RAZORPAY_SIGNATURE_INVALID`
- Logs include `RAZORPAY_WEBHOOK_FAIL`

### C) Misconfigured Keys -> App Fails at Boot

Test each case independently and restart backend each time:

1. `PAYMENTS_MODE=test` with `RAZORPAY_KEY_ID=rzp_live_...`
2. `PAYMENTS_MODE=live` with `RAZORPAY_KEY_ID=rzp_test_...`
3. Missing `RAZORPAY_KEY_ID` or missing `RAZORPAY_KEY_SECRET`

Expected:

- Backend process fails during startup.
- Startup log includes structured event `RAZORPAY_CONFIG_INVALID`.
- Reason/code includes mismatch or missing config (for example `RAZORPAY_CONFIG_MODE_MISMATCH`, `RAZORPAY_CONFIG_MISSING`).

### D) Simulate 429 -> Retry Then `RAZORPAY_RATE_LIMIT`

Manual black-box path (best effort):

1. Rapidly create/initiate multiple distinct payment sessions (distinct carts/payment collections) via Postman runner.
2. Watch for response mapped as `RAZORPAY_RATE_LIMIT` once upstream 429 is hit.

Expected when hit:

- Retry policy is method-aware:
  - status/read fetch paths may retry
  - booking (`/v1/orders`) and capture (`/v1/payments/:id/capture`) fail fast (no retry)
- Final failure is graceful and mapped to `RAZORPAY_RATE_LIMIT`.
- Log includes `RAZORPAY_API_CALL_FAILED` with status `429` and `correlation_id`.

Deterministic fallback (recommended if sandbox does not rate-limit consistently):

- Run unit tests:
  - `yarn test:unit -- src/modules/payment-razorpay/__tests__/service.unit.spec.tsx -t "retries on 429 for status fetch and succeeds within max retries"`
  - `yarn test:unit -- src/modules/payment-razorpay/__tests__/service.unit.spec.tsx -t "does not retry on 429 for order creation (booking path)"`
  - `yarn test:unit -- src/modules/payment-razorpay/__tests__/service.unit.spec.tsx -t "does not retry on 429 for capture path"`

## 5) Correlation ID: Where QA Finds It

1. UI error banner:
   - Shows `Support Code: <id>` on checkout errors.
2. API responses:
   - Header: `x-correlation-id`
   - Error JSON: `error.correlation_id`
   - Success JSON (where applicable): `correlation_id`
3. Server logs:
   - Search by correlation id value to trace full flow across initiate/authorize/webhook.

## Definition of Done

- Razorpay API smoke request returns `200` with test credentials.
- Happy-path payment completes and order becomes paid/captured.
- Close-tab scenario still ends in paid/captured via webhook reconciliation.
- Signature tampering returns `SIGNATURE_INVALID` with correlation id.
- Invalid webhook signature is rejected with `RAZORPAY_SIGNATURE_INVALID`.
- Misconfigured keys fail boot with `RAZORPAY_CONFIG_INVALID` log.
- 429 behavior is validated (manual if reproducible, otherwise deterministic unit-test fallback) and maps to `RAZORPAY_RATE_LIMIT`.
- QA can capture and provide correlation id for any failure without dev assistance.
