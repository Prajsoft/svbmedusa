# Fulfillment Intent and Shipment Contract v1

## Purpose

Define a stable fulfillment intent model and a carrier-ready shipment contract for the SVB Medusa backend before carrier integration.

## Scope

- This is a contract/spec document only.
- No Shiprocket or other carrier API integration is included in v1.

## Fulfillment Lifecycle States

- `requested`
- `ready_for_shipment`
- `shipped`
- `delivered`
- `delivery_failed`
- `rto_initiated`
- `rto_delivered`

## State Triggers

- Order placed successfully -> `requested`
  - Trigger: order placement completion.
  - Event intent: `fulfillment.requested`.

- Shipment created (later integration step) -> `ready_for_shipment`
  - Trigger: carrier shipment creation succeeds against prepared shipment contract.
  - Event intent: `fulfillment.ready_for_shipment`.

- Tracking update (carrier webhook/polling, later integration step) -> `shipped`
  - Trigger: first in-transit/out-for-delivery style update.
  - Event intent: `fulfillment.shipped`.

- Tracking update (carrier webhook/polling, later integration step) -> `delivered`
  - Trigger: delivery confirmation update.
  - Event intent: `fulfillment.delivered`.

- Tracking update (carrier webhook/polling, later integration step) -> `delivery_failed`
  - Trigger: non-delivered/failed delivery update.
  - Event intent: `fulfillment.delivery_failed`.

- Tracking update (carrier webhook/polling, later integration step) -> `rto_initiated`
  - Trigger: return-to-origin started.
  - Event intent: `fulfillment.rto_initiated`.

- Tracking update (carrier webhook/polling, later integration step) -> `rto_delivered`
  - Trigger: return-to-origin delivered at origin.
  - Event intent: `fulfillment.rto_delivered`.

## Shipment Contract

Carrier-ready object shape that must be constructible from an order:

```ts
type ShipmentContractV1 = {
  order_id: string
  pickup_location_code: "WH-MRT-01"
  pickup_address: {
    name: string
    phone: string
    line1: string
    line2?: string
    city: string
    state: string
    postal_code: string
    country_code: string
  }
  delivery_address: {
    name: string
    phone: string
    line1: string
    line2?: string
    city: string
    state: string
    postal_code: string
    country_code: string
  }
  packages: Array<{
    weight_grams: number
    dimensions_cm: {
      l: number
      w: number
      h: number
    }
    items: Array<{
      sku: string
      qty: number
      name: string
    }>
  }>
  cod: {
    enabled: boolean
    amount: number
  }
  invoice_ref: string
  notes?: string
}
```

## Packaging Rules (v1)

- All items are treated as `SMALL` for v1.
- Combine all order items into exactly one package for now.
- Keep `packages` as an array even in v1 so multi-package logic can be added without contract changes.
- Single-package value derivation:
  - `items`: all line items mapped to `{ sku, qty, name }`
  - `weight_grams`: sum of line-item total weights
  - `dimensions_cm`: temporary aggregate package dimensions for v1 (deterministic packed dimensions from item metadata)

## Notes

- `invoice_ref` should use the order number/reference.
- `cod.enabled` and `cod.amount` are derived from order payment method and outstanding COD payable amount.
