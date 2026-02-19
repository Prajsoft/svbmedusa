# Shipping Eligibility v1

## Metadata standard

Use variant-level metadata for COD eligibility:

- Key: `variant.metadata.cod_eligible`
- Type: boolean
- Allowed values:
  - `true` -> variant can be shipped with COD
  - `false` -> variant cannot be shipped with COD

Reason for variant-level storage:
- COD rules can differ across packs/variants of the same product.

## Engine behavior

COD is eligible for a cart only when **all** cart variants are COD-eligible.

Fail-safe defaults:
- Missing `cod_eligible` is treated as `false`.
- Non-boolean/invalid values are treated as `false`.

## API effects

- Shipping options listing (`GET /store/shipping-options`):
  - COD options are filtered out when cart is not eligible.
- Shipping selection (`POST /store/carts/:id/shipping-methods`):
  - selecting COD on ineligible cart fails with:
    - `code: SHIPPING_OPTION_INELIGIBLE`
    - reason message explaining COD requires `metadata.cod_eligible=true` on all variants.

## Example variant metadata

```json
{
  "cod_eligible": true,
  "shipping_class": "SMALL",
  "weight_grams": 180,
  "dimensions_cm": { "l": 10, "w": 5, "h": 5 }
}
```
