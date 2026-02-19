# Coupon Apply Failures Runbook

## Symptoms

- Customer cannot apply coupon at cart/checkout.
- API returns stable coupon errors such as:
  - `COUPON_INVALID`
  - `COUPON_EXPIRED`
  - `COUPON_NOT_STARTED`
  - `COUPON_MIN_CART_NOT_MET`
  - `COUPON_USAGE_LIMIT_REACHED`
  - `COUPON_STACKING_NOT_ALLOWED`

## Checks

- For checkout-blocking cases, open `GET /admin/ops/order/:id/timeline` (if order exists).
- Check promotion events:
  - `promotion.applied` missing or inconsistent with cart state.
- Check for guardrail violations:
  - stacking conflicts
  - usage/budget exhaustion
  - campaign start/end window
  - minimum cart threshold
- Validate coupon setup in Medusa promotions/campaigns.

## Likely Causes

- Expired or not-yet-started campaign.
- Usage limit reached at promotion or campaign-budget level.
- Cart ineligible due to subtotal rules.
- Multiple manual coupons attempted or auto+manual stacking disallowed.

## Resolution Steps

1. Identify returned error code and map to rule:
   - date window, usage limit, minimum cart, or stacking policy.
2. Correct promotion/campaign configuration in admin if misconfigured.
3. Ask customer to re-apply coupon after correction.
4. If cart state is stale, remove and re-apply coupon from client flow.
5. Ops action note:
   - There is no dedicated `/admin/ops/actions/*` coupon remediation action in v1.
   - Coupon remediation is configuration + re-apply workflow driven.

## Verification Steps

- Coupon applies successfully in cart flow.
- Checkout proceeds without coupon validation errors.
- Timeline/events show successful `promotion.applied` where applicable.
- No repeated coupon failure for the same corrected scenario.
