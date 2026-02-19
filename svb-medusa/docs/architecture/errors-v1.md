# Errors V1

This backend now uses a shared error taxonomy in `src/modules/observability/errors.ts`.

## Error Model

`AppError` fields:

- `code`: stable machine-readable error code
- `category`: `validation | integrity | transient_external | permanent_external | internal`
- `httpStatus`: HTTP status for API responses
- `message`: safe human-readable message
- `details` (optional): structured context (non-secret)

## Stable API Error Payload

All admin/store routes using the shared mapper return:

```json
{
  "code": "OUT_OF_STOCK",
  "message": "Insufficient inventory for SKU SVB-CRB-SWFP-WHT-P01 at WH-MRT-01"
}
```

The response shape is always:

```json
{
  "code": "<STABLE_ERROR_CODE>",
  "message": "<SAFE_MESSAGE>"
}
```

No stack traces are returned to clients.

## Mapped Business Codes (Current)

The following previously introduced codes are explicitly mapped into `AppError` taxonomy:

- `OUT_OF_STOCK` -> `validation` (400)
- `SKU_INVALID_FORMAT` -> `validation` (400)
- `MISSING_LOGISTICS_METADATA` -> `validation` (400)
- `SHIPPING_OPTION_INELIGIBLE` -> `validation` (400)
- `PRICE_INTEGRITY_VIOLATION` -> `integrity` (400)

## Helper Constructors

Use these helpers to create typed errors:

- `validationError(code, message, options?)`
- `integrityError(code, message, options?)`
- `transientExternalError(code, message, options?)`
- `permanentExternalError(code, message, options?)`
- `internalError(code, message, options?)`

For route handlers, use `toApiErrorResponse(error)` to emit stable payloads.
