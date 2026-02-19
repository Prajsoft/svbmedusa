# Structured Logging + Correlation IDs (V1)

## What is implemented

- `x-correlation-id` request propagation middleware for `/store` and `/admin` routes.
- Request correlation context using async local storage.
- JSON logger wrapper with common fields:
  - `timestamp`, `level`, `message`
  - `correlation_id`
  - `workflow_name`, `step_name`
  - `cart_id`, `order_id`, `return_id`
  - `error_code` (when relevant)
- Business event emitter wrapper that automatically injects `correlation_id` into emitted event payloads.

## Data safety

- Sensitive keys are filtered from logs (`secret`, `token`, `password`, `authorization`, `api_key`, etc.).
- Address-like keys are filtered (`address*`) to avoid logging full addresses.

## Example checkout-path logs

```json
{"timestamp":"2026-02-18T11:05:10.114Z","level":"info","message":"HTTP request received","correlation_id":"corr-checkout-123","step_name":"http_request","cart_id":"cart_01","meta":{"method":"POST","path":"/store/carts/cart_01/complete"}}
{"timestamp":"2026-02-18T11:05:10.201Z","level":"info","message":"Authorizing COD payment session","correlation_id":"corr-checkout-123","workflow_name":"checkout_cod_payment_authorize","step_name":"start","cart_id":"cart_01"}
{"timestamp":"2026-02-18T11:05:10.287Z","level":"info","message":"Business event emitted: payment.authorized","correlation_id":"corr-checkout-123","workflow_name":"checkout_cod_payment_authorize","step_name":"emit_event","cart_id":"cart_01"}
```
