# Promotions and Price Integrity v1

## Scope and principles

- Medusa native Promotions/Campaigns modules are the single source of truth for discount calculation and persistence.
- No custom discount calculator/engine is allowed.
- SVB custom logic in v1 is limited to guardrails:
  - stacking policy checks
  - price integrity checks
  - stable error code mapping

## 1) Supported promotion types (v1)

- Manual `% off` coupon: supported.
- Manual fixed-amount coupon: supported.
- Free shipping coupon: not supported by default in v1.
  - Controlled by feature flag: `PROMO_ALLOW_FREE_SHIPPING`
  - Default: `false`

## 2) Stacking policy (v1)

- Only one manual coupon can be active at a time.
- Automatic promotions + manual coupon together are not allowed in v1.
  - Controlled by feature flag: `PROMO_ALLOW_AUTO_PLUS_MANUAL`
  - Default: `false`

## 3) Price integrity rules (v1)

These checks must run:
- when a coupon/promotion is applied
- again at final order placement (safety gate)

Rules:
- Totals must never become negative.
- Discount must never exceed subtotal (order-level or line-level, per Medusa semantics).
- Shipping discount must never exceed shipping cost.
- Rounding follows Medusa totals; SVB guardrail validates the final computed values are sane.

## 4) Stable error codes

- `COUPON_INVALID`
- `COUPON_EXPIRED`
- `COUPON_NOT_STARTED`
- `COUPON_MIN_CART_NOT_MET`
- `COUPON_USAGE_LIMIT_REACHED`
- `COUPON_STACKING_NOT_ALLOWED`
- `PRICE_INTEGRITY_VIOLATION`

## 5) Feature flags (v1 defaults)

- `PROMO_ALLOW_FREE_SHIPPING=false`
- `PROMO_ALLOW_AUTO_PLUS_MANUAL=false`

