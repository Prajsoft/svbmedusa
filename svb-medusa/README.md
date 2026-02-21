<p align="center">
  <a href="https://www.medusajs.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://user-images.githubusercontent.com/59018053/229103275-b5e482bb-4601-46e6-8142-244f531cebdb.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    <img alt="Medusa logo" src="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    </picture>
  </a>
</p>
<h1 align="center">
  Medusa
</h1>

<h4 align="center">
  <a href="https://docs.medusajs.com">Documentation</a> |
  <a href="https://www.medusajs.com">Website</a>
</h4>

<p align="center">
  Building blocks for digital commerce
</p>
<p align="center">
  <a href="https://github.com/medusajs/medusa/blob/master/CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome!" />
  </a>
    <a href="https://www.producthunt.com/posts/medusa"><img src="https://img.shields.io/badge/Product%20Hunt-%231%20Product%20of%20the%20Day-%23DA552E" alt="Product Hunt"></a>
  <a href="https://discord.gg/xpCwq3Kfn8">
    <img src="https://img.shields.io/badge/chat-on%20discord-7289DA.svg" alt="Discord Chat" />
  </a>
  <a href="https://twitter.com/intent/follow?screen_name=medusajs">
    <img src="https://img.shields.io/twitter/follow/medusajs.svg?label=Follow%20@medusajs" alt="Follow @medusajs" />
  </a>
</p>

## Compatibility

This starter is compatible with versions >= 2 of `@medusajs/medusa`. 

## Getting Started

Visit the [Quickstart Guide](https://docs.medusajs.com/learn/installation) to set up a server.

Visit the [Docs](https://docs.medusajs.com/learn/installation#get-started) to learn more about our system requirements.

## What is Medusa

Medusa is a set of commerce modules and tools that allow you to build rich, reliable, and performant commerce applications without reinventing core commerce logic. The modules can be customized and used to build advanced ecommerce stores, marketplaces, or any product that needs foundational commerce primitives. All modules are open-source and freely available on npm.

Learn more about [Medusa’s architecture](https://docs.medusajs.com/learn/introduction/architecture) and [commerce modules](https://docs.medusajs.com/learn/fundamentals/modules/commerce-modules) in the Docs.

## Product Feed Config

The `/product-feed` endpoint is guarded and disabled by default. Configure these variables:

- `ENABLE_PRODUCT_FEED=false`
- `PRODUCT_FEED_TOKEN=<long-random-token>`
- `STOREFRONT_URL=<your storefront domain>`
- `PRICES_ARE_MINOR_UNITS=true`

## Payments

- [Payments Overview (Foundation)](docs/payments/overview.md)
- [Payments State Machine Spec](docs/payments/state-machine.md)
- [Payments Webhooks](docs/payments/webhooks.md)
- [Payments Observability](docs/payments/observability.md)
- [Payments Reconciliation](docs/payments/reconciliation.md)
- [Adding a Payment Provider](docs/payments/adding-a-provider.md)
- [Pluggable Payments Foundation (v1)](docs/architecture/payments-pluggable-v1.md)
- [Razorpay Integration (architecture + operations)](docs/payments/razorpay.md)
- [Razorpay WIP QA Runbook](docs/razorpay-wip-test.md)

## Razorpay Test Mode (v1)

Razorpay is wired as a Medusa payment provider (`pp_razorpay_razorpay`) and stays server-side only.

Required env:

- `PAYMENTS_MODE=test`
- `ENABLE_RAZORPAY=true`
- `RAZORPAY_KEY_ID=rzp_test_...`
- `RAZORPAY_KEY_SECRET=...`
- `RAZORPAY_WEBHOOK_SECRET=...`
- `PAYMENTS_ALLOW_UNVERIFIED_WEBHOOKS=false` (keep false outside controlled emergency testing)

Guardrails at boot:

- `PAYMENTS_MODE=test` + `rzp_live_` key => app boot fails.
- `PAYMENTS_MODE=live` + `rzp_test_` key => app boot fails.
- Missing `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` => app boot fails (`RAZORPAY_CONFIG_MISSING`).
- Missing `RAZORPAY_WEBHOOK_SECRET` in `PAYMENTS_MODE=live` => app boot fails (`RAZORPAY_CONFIG_MISSING`).
- Missing Razorpay provider registration at boot => app boot fails (`RAZORPAY_PROVIDER_REGISTRATION_FAILED`).
- Invalid `PAYMENT_PROVIDER_DEFAULT` (not registered at boot) => app boot fails (`PAYMENT_PROVIDER_DEFAULT_INVALID`).
- Invalid startup config is logged as structured event `RAZORPAY_CONFIG_INVALID` without secrets.
- Webhooks are verified by default; unverified acceptance only works with explicit `PAYMENTS_ALLOW_UNVERIFIED_WEBHOOKS=true`.

Webhook endpoint:

- `POST /hooks/payment/razorpay_razorpay`
- `POST /webhooks/payments/razorpay` (canonical shared webhook pipeline route)
- `POST /webhooks/razorpay` (deprecated compatibility alias that delegates to shared pipeline)
- Webhook idempotency is stored in `razorpay_webhook_events` (`id` unique, with `event_type`, `provider_payment_id`, `created_at`).
- Duplicate webhook events are ignored and logged as `WEBHOOK_DEDUP_HIT`.
- Reconciliation mapping:
  - `payment.authorized` => authorized
  - `payment.captured` => captured/paid
  - `payment.failed` => failed/error

For v1, INR is enforced in backend payment validation.
- Razorpay API calls use one canonical SDK client (`getRazorpayClient`) and `razorpayRequest(...)`.
- Retry policy is strict: retry only on network errors, HTTP `429`, and `5xx` (max 3 attempts with exponential backoff + jitter).
- `initiatePayment` is idempotent and concurrency-safe per Medusa payment session (single Razorpay order persisted in `razorpay_session_order_v1` with metadata).
- Order creation logs `RAZORPAY_ORDER_CREATE_ATTEMPT` and `RAZORPAY_ORDER_CREATED` with `correlation_id`.
- Upstream error mapping: `401/403 -> RAZORPAY_AUTH_FAILED`, `400 -> RAZORPAY_BAD_REQUEST`, `429 -> RAZORPAY_RATE_LIMIT`, `network/5xx -> RAZORPAY_UPSTREAM_ERROR`.
- Checkout authorization verifies Razorpay HMAC signature server-side (`order_id|payment_id`) before setting `AUTHORIZED`.
- Authorization failures: missing payload fields => `VALIDATION_ERROR`; signature mismatch => `SIGNATURE_INVALID`.
- Signature verification logs: `RAZORPAY_SIGNATURE_VERIFICATION_OK` and `RAZORPAY_SIGNATURE_VERIFICATION_FAIL`.
- `cancelPayment` marks unpaid sessions as canceled and rejects paid sessions with `CANNOT_CANCEL_PAID_PAYMENT`.
- `refundPayment` is supported for Razorpay captured payments and records `razorpay_refund_id` on success.
- Observability events include: `RAZORPAY_ORDER_CREATED`, `RAZORPAY_CHECKOUT_INITIATED`, `RAZORPAY_SIGNATURE_OK/FAIL`, `RAZORPAY_WEBHOOK_OK/FAIL`.
- Counters emitted: `razorpay.order_create.success|fail`, `razorpay.authorize.success|fail`, `razorpay.webhook.success|fail`.
- Internal debug helper: `GET /admin/ops/debug/razorpay-payment?cart_id=...` or `?order_id=...` (admin auth required).
- Reconciliation job: `src/jobs/payment-reconciliation.ts` (stuck session scan + idempotent forward reconciliation).
- `.env.template` defaults `RAZORPAY_TEST_AUTO_AUTHORIZE=false`; set it explicitly only for local test shortcuts.

## Correlation + Logging

- Backend requests read `x-correlation-id` when provided, otherwise generate UUIDs.
- Response header always includes `x-correlation-id`.
- Error JSON includes `correlation_id`.
- Structured event logging uses `logEvent(eventName, payload, correlation_id)` with automatic redaction for secrets and authorization headers.

## Community & Contributions

The community and core team are available in [GitHub Discussions](https://github.com/medusajs/medusa/discussions), where you can ask for support, discuss roadmap, and share ideas.

Join our [Discord server](https://discord.com/invite/medusajs) to meet other community members.

## Other channels

- [GitHub Issues](https://github.com/medusajs/medusa/issues)
- [Twitter](https://twitter.com/medusajs)
- [LinkedIn](https://www.linkedin.com/company/medusajs)
- [Medusa Blog](https://medusajs.com/blog/)
