# SKU Enforcement Plan (Admin Layer First)

## Current state in this repo

- There are no custom Admin product/variant routes under `src/api/admin`.
- Product/variant create/update currently run through Medusa core Admin routes from `@medusajs/medusa`.
- Existing custom validation helpers live in:
  - `src/modules/catalog/validate-sku.ts`
  - `src/modules/catalog/sku-rules.ts`

## Exact create/update entry points (current runtime)

### 1) Create product (can include variants)
- Route handler file: `node_modules/@medusajs/medusa/dist/api/admin/products/route.js`
- Function/export: `POST`
- Workflow called: `createProductsWorkflow(req.scope).run(...)`

### 2) Update product (can include variants)
- Route handler file: `node_modules/@medusajs/medusa/dist/api/admin/products/[id]/route.js`
- Function/export: `POST`
- Workflow called: `updateProductsWorkflow(req.scope).run(...)`

### 3) Create variant directly
- Route handler file: `node_modules/@medusajs/medusa/dist/api/admin/products/[id]/variants/route.js`
- Function/export: `POST`
- Workflow called: `createProductVariantsWorkflow(req.scope).run(...)`

### 4) Update variant directly
- Route handler file: `node_modules/@medusajs/medusa/dist/api/admin/products/[id]/variants/[variant_id]/route.js`
- Function/export: `POST`
- Workflow called: `updateProductVariantsWorkflow(req.scope).run(...)`

## Request schema locations (where `sku` exists)

- Schema file: `node_modules/@medusajs/medusa/dist/api/admin/products/validators.js`
- Relevant schema names:
  - `CreateProductVariant` (`sku` field)
  - `UpdateProductVariant` (`sku` field)
  - `CreateProduct` (`variants?: CreateProductVariant[]`)
  - `UpdateProduct` (`variants?: UpdateProductVariant[]`)
  - `AdminCreateProductVariant` (wrapper)
  - `AdminUpdateProductVariant` (wrapper)

## Safest enforcement points (no direct DB writes, server-side only)

Recommended first enforcement layer: Admin API middleware in this repo.

Implement in a new app-level middleware file:
- `src/api/middlewares.ts`

Hook by route matcher (Admin only):
- `POST /admin/products`
  - Validate each `variants[].sku` (if present) using `assertValidSku()`.
- `POST /admin/products/:id`
  - Validate each `variants[].sku` in update payload (if present).
- `POST /admin/products/:id/variants`
  - Validate `sku` in variant create payload.
- `POST /admin/products/:id/variants/:variant_id`
  - Validate `sku` in variant update payload when provided.

How to validate:
- Use `assertValidSku(sku)` from `src/modules/catalog/validate-sku.ts`.
- Throw `SkuValidationError` -> map to 4xx response in middleware.

## Optional second-pass hardening (later)

After Admin-layer enforcement is live, extend coverage to batch/import paths:
- `POST /admin/products/batch`
- `POST /admin/products/:id/variants/batch`
- product import flows

This protects against non-standard payload shapes while still avoiding direct DB writes.
