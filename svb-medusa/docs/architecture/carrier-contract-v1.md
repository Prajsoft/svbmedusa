# Carrier Integration Contract v1

## Purpose

Define a carrier-agnostic integration contract for fulfillment so Shiprocket can be added now and other carriers can be added later without changing core workflow semantics.

## Scope

- No external API calls in this step.
- No carrier-specific implementation details in this contract.
- This contract is consumed by fulfillment workflows/services.

## Carrier Adapter Interface

```ts
type CarrierTrackingStatus =
  | "requested"
  | "ready_for_shipment"
  | "shipped"
  | "delivered"
  | "delivery_failed"
  | "rto_initiated"
  | "rto_delivered"
  | "unknown"

type CarrierTrackingEvent = {
  status: CarrierTrackingStatus
  timestamp: string
  location?: string
  note?: string
  raw_status?: string
}

type CreateShipmentResult = {
  carrier_shipment_id: string
  label_url?: string
  tracking_number?: string
}

type CancelShipmentResult = {
  cancelled: boolean
}

type GetTrackingResult = {
  status: CarrierTrackingStatus
  history: CarrierTrackingEvent[]
}

interface CarrierAdapter {
  createShipment(shipmentContract: ShipmentContract): Promise<CreateShipmentResult>
  cancelShipment(carrier_shipment_id: string): Promise<CancelShipmentResult>
  getTracking(input: {
    carrier_shipment_id?: string
    tracking_number?: string
  }): Promise<GetTrackingResult>
  verifyWebhook?(request: {
    headers: Record<string, string | string[] | undefined>
    raw_body: string
    body?: unknown
  }): boolean
}
```

## Shipment Contract (Carrier Input)

`ShipmentContract` reuses the fulfillment contract defined in `docs/architecture/fulfillment-v1.md` and is the canonical adapter input.

```ts
type ShipmentContract = {
  order_id: string
  pickup_location_code: string
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

### Minimal Required Fields

- pickup: `pickup_location_code`, `pickup_address`
- delivery: `delivery_address`
- packages: each package with weight, dimensions, items
- COD: `cod.enabled`, `cod.amount`
- invoice reference: `invoice_ref`
- items summary: package item list (`sku`, `qty`, `name`) and package count/weight totals

## Internal Persistence Model

Recommended storage location: order metadata under existing fulfillment intent object.

Path:
- `order.metadata.fulfillment_intents_v1[<idempotency_key>]`

Recommended keys:

```ts
type FulfillmentIntentCarrierRef = {
  adapter_code: string
  carrier_shipment_id: string
  tracking_number?: string
  label_url?: string
  created_at: string
  cancelled_at?: string
}
```

Merged into:

```ts
type FulfillmentIntentRecord = {
  idempotency_key: string
  fulfillment_attempt: number
  state: "requested" | "ready_for_shipment" | "shipped" | "delivered" | "delivery_failed" | "rto_initiated" | "rto_delivered"
  requested_at: string
  shipment_contract_summary: {
    pickup_location_code: string
    package_count: number
    total_weight_grams: number
    cod: { enabled: boolean; amount: number }
    invoice_ref: string
  }
  carrier_ref?: FulfillmentIntentCarrierRef
  last_tracking_sync_at?: string
  last_error?: {
    code: string
    message: string
    type: "transient" | "permanent" | "validation"
    at: string
  }
}
```

## Idempotency Rule

- Key format: `order_id + ":" + fulfillment_attempt`
  - example: `order_123:1`
- Before `createShipment`, check:
  - `order.metadata.fulfillment_intents_v1[idempotency_key].carrier_ref.carrier_shipment_id`
- If `carrier_shipment_id` already exists:
  - do not call `createShipment` again
  - treat as idempotent replay and return stored carrier refs

## Standard Error Model

Use normalized internal error categories independent of carrier.

### Validation Errors

- Type: `validation`
- Meaning: payload/contract invalid before or at adapter boundary.
- Examples:
  - missing address fields
  - invalid package dimensions
  - unsupported COD combination
- Retry policy: do not auto-retry until data fixed.

### Transient Errors

- Type: `transient`
- Meaning: temporary failures likely to recover.
- Examples:
  - network timeout
  - rate limit
  - 5xx from carrier
- Retry policy: safe retry with backoff; preserve idempotency key.

### Permanent Errors

- Type: `permanent`
- Meaning: request accepted by adapter layer but cannot be completed without business intervention.
- Examples:
  - pickup location rejected by carrier
  - destination service unavailable for lane
  - account/credential-level rejection
- Retry policy: no blind retry; raise ops alert and require action.

## Events

Carrier adapters do not directly mutate business state outside workflow boundaries. Workflows emit normalized events:

- `fulfillment.requested`
- `fulfillment.request_failed`
- `fulfillment.ready_for_shipment`
- `fulfillment.shipped`
- `fulfillment.delivered`
- `fulfillment.delivery_failed`
- `fulfillment.rto_initiated`
- `fulfillment.rto_delivered`
