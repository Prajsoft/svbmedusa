# Product Feed (Meta/Google)

## Overview

This document defines the v1 Product Feed endpoint contract and rollout controls for Meta/Google ingestion.

Current scope:
- Expose `/product-feed` as an XML endpoint.
- Add hard safety controls (feature flag + token guard).
- Restrict feed scope to products assigned to the dedicated `Feed` Sales Channel.
- Keep feed disabled by default until content/data QA is complete.

## Safety Controls (feature flag, token, sales channel)

The endpoint is guarded by three controls:

1. Feature flag:
   - `ENABLE_PRODUCT_FEED=false` by default.
   - When `false`, endpoint responds with `FEED_DISABLED`.
2. Access token:
   - `PRODUCT_FEED_TOKEN` must be configured.
   - Request must include token in query (`?token=...`) or `x-product-feed-token` header.
   - Invalid/missing token responds with `UNAUTHORIZED`.
3. Sales channel scope:
   - Create a Sales Channel named exactly `Feed`.
   - Only products assigned to `Feed` should be included in feed output.

### Config

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ENABLE_PRODUCT_FEED` | Yes | `false` | Hard on/off switch for feed endpoint |
| `PRODUCT_FEED_TOKEN` | Yes | none | Shared secret for feed endpoint authentication |
| `STOREFRONT_URL` | Yes | none | Canonical storefront URL for product links |
| `PRICES_ARE_MINOR_UNITS` | No | `true` | Price unit mode (`true` means minor units, e.g. INR paise) |

## Data Model (FeedItem fields)

Implemented `FeedItem` shape:

- `id` (variant id)
- `title` (product + variant title)
- `description` (product description)
- `link` (`${STOREFRONT_URL}/{country}/products/{handle}`)
- `image_link` (thumbnail/first image)
- `additional_image_links: string[]`
- `availability: "in stock" | "out of stock"`
- `price` (formatted like `1999.00 INR`)
- `sale_price?: string`
- `item_group_id` (product id)
- `condition?: string` (default `new`)
- `brand?: string` (from metadata when present)

Notes:
- If a variant has no calculated price, it is skipped and a warning is recorded.
- If no country-matched sales channel exists, managed-inventory variants are included as `out of stock` (not dropped).

## Workflow Steps (get items, build XML)

Planned flow:
1. Validate endpoint safety controls (flag + token + query shape).
2. Call `getProductFeedItemsStep` (`src/workflows/steps/get-product-feed-items.ts`):
   - Validate setup:
     - fail fast if `STOREFRONT_URL` missing
     - fail fast if Sales Channel `Feed` does not exist
   - Query published products in pages of 100 with:
     - product core fields
     - variants + `variants.calculated_price.*`
     - sales channels + stock location addresses
   - Filter to products assigned to Sales Channel `Feed`.
   - For each product:
     - pick country-matched sales channel by stock-location address country
     - compute managed variant availability using `getVariantAvailability(...)`
     - format prices via `PRICES_ARE_MINOR_UNITS` policy
     - build feed links via `buildProductUrl(...)`
     - collect warnings and skipped variants
3. Call `buildProductFeedXmlStep` (`src/workflows/steps/build-product-feed-xml.ts`):
   - Input: `{ items: FeedItem[] }`
   - Output: RSS XML string:
     - root `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`
     - `<channel>` with title/description/link/lastBuildDate
     - `<item>` per feed item with escaped XML-safe text
   - Emits repeated `<g:additional_image_link>` tags (one tag per image)
   - Never throws for empty items; returns valid RSS with empty channel.
4. Return XML with `application/xml; charset=utf-8`.

### Workflow: generateProductFeedWorkflow

Workflow file:
- `src/workflows/generate-product-feed.ts`

Input:
- `currency_code` (example: `INR`)
- `country_code` (example: `IN`)

Execution:
1. Calls `getProductFeedItemsStep(input)` to build feed-safe item data.
2. Calls `buildProductFeedXmlStep({ items })` using only extracted items.
3. Returns `WorkflowResponse({ xml })`.

Error behavior:
- Setup/validation errors from steps are not swallowed.
- Missing `STOREFRONT_URL` or missing Sales Channel `Feed` bubble to caller as-is.

## Middleware / Validation

Route-level query validation is applied in `src/api/middlewares.ts` for `GET /product-feed` using:
- `validateAndTransformQuery(...)`
- a strict zod schema requiring:
  - `currency_code` (string)
  - `country_code` (string)
  - `token` (string)

Validation behavior:
- Missing/invalid query fields are rejected before the route handler runs.
- Validation errors are normalized for `/product-feed` to:

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "<zod message>"
  }
}
```

## API Route (/product-feed)

Route:
- `GET /product-feed`

Required query parameters:
- `currency_code` (example: `INR`)
- `country_code` (example: `IN`)
- `token` (must match `PRODUCT_FEED_TOKEN`)

Behavior:
1. If `ENABLE_PRODUCT_FEED !== "true"`:
   - status: `404`
   - body:
     ```json
     { "error": { "code": "FEED_DISABLED", "message": "Product feed is disabled" } }
     ```
2. If `token` is wrong:
   - status: `401`
   - body:
     ```json
     { "error": { "code": "UNAUTHORIZED", "message": "Invalid token" } }
     ```
3. On success:
   - runs `generateProductFeedWorkflow(req.scope).run({ input })`
   - status: `200`
   - headers:
     - `Content-Type: application/rss+xml; charset=utf-8`
     - `Cache-Control: public, max-age=300`
   - body: full RSS XML

Robustness:
- The route only writes XML after workflow success, so errors never return partial XML.
- Route errors are logged with request id when available.

## Error Handling

Error response format (JSON):

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "A valid product feed token is required."
  }
}
```

Error codes:
- `FEED_DISABLED`
- `UNAUTHORIZED`
- `INVALID_QUERY`

## Testing (step-wise)

Do this in order:
1. Confirm Sales Channel exists in Medusa Admin:
   - Name must be exactly `Feed`.
2. Confirm env vars are documented/configured:
   - `ENABLE_PRODUCT_FEED`
   - `PRODUCT_FEED_TOKEN`
   - `STOREFRONT_URL`
   - `PRICES_ARE_MINOR_UNITS`
3. Create 1-2 test products and assign them to Sales Channel `Feed`.
4. Restart Medusa server and confirm startup has no runtime errors.
5. Validate endpoint guards:
   - Disabled flag returns `FEED_DISABLED`.
   - Missing/wrong token returns `UNAUTHORIZED`.
   - Unsupported query params return `INVALID_QUERY`.
6. Enable flag and call endpoint with valid token; confirm XML response.

### Testing step 2: extraction script

Run the extraction step directly:

```bash
npx medusa exec ./src/scripts/test-product-feed-items.ts INR IN
```

Expected output includes:
- `total items: <number>`
- `first 2 items:` (JSON preview)
- `skipped variants: <number>`
- `skipped reasons:` (reason count map)
- `warnings: <number>`

### Testing step 3: XML builder validation

Run XML generation + strict lint:

```bash
npx medusa exec ./src/scripts/test-product-feed-xml.ts
```

Run with live extracted feed items:

```bash
npx medusa exec ./src/scripts/test-product-feed-xml.ts INR IN --live
```

The script validates XML using:

```bash
xmllint --noout -
```

Expected output:
- `xmllint passed`
- first 40 lines of generated XML
- repeated `<g:additional_image_link>` tags when additional images exist

### Testing step 4: workflow wrapper validation

Run the full workflow wrapper:

```bash
npx medusa exec ./src/scripts/test-generate-product-feed.ts INR IN
```

What it does:
- runs `generateProductFeedWorkflow`
- writes XML to system temp folder as `product-feed.xml`
- validates output via `xmllint --noout -`
- prints first 50 lines of generated XML

Expected output:
- `wrote xml: <temp-path>/product-feed.xml`
- `xmllint passed`
- XML header + RSS channel lines in console output

### Testing step 5: API route behavior + XML lint

Assume:
- Medusa running at `http://localhost:9000`
- env has `PRODUCT_FEED_TOKEN`

1. Feed disabled check:

```bash
ENABLE_PRODUCT_FEED=false
curl -i "http://localhost:9000/product-feed?currency_code=INR&country_code=IN&token=${PRODUCT_FEED_TOKEN}"
```

Expected:
- HTTP `404`
- JSON body with `code=FEED_DISABLED`

2. Invalid token check:

```bash
ENABLE_PRODUCT_FEED=true
curl -i "http://localhost:9000/product-feed?currency_code=INR&country_code=IN&token=wrong-token"
```

Expected:
- HTTP `401`
- JSON body with `code=UNAUTHORIZED`

3. Success check:

```bash
ENABLE_PRODUCT_FEED=true
curl -i "http://localhost:9000/product-feed?currency_code=INR&country_code=IN&token=${PRODUCT_FEED_TOKEN}"
```

Expected:
- HTTP `200`
- `Content-Type: application/rss+xml; charset=utf-8`
- XML body

4. XML validity check from HTTP response:

```bash
curl -s "http://localhost:9000/product-feed?currency_code=INR&country_code=IN&token=${PRODUCT_FEED_TOKEN}" | xmllint --noout -
```

Expected:
- no output
- exit code `0`

### Testing step 6: middleware validation fail-fast

Missing `currency_code` must fail with `400` before route handler logic:

```bash
curl -i "http://localhost:9000/product-feed?country_code=IN&token=${PRODUCT_FEED_TOKEN}"
```

Expected:
- HTTP `400`
- JSON body:
  ```json
  {
    "error": {
      "code": "INVALID_QUERY",
      "message": "..."
    }
  }
  ```

### How to run tests locally

1. Start Medusa backend:
   - `cd svb-medusa`
   - `yarn dev`
2. Seed or prepare feed-eligible products:
   - Create/assign products to Sales Channel `Feed` in Admin.
3. Call `/product-feed` with required auth/token:
   - `curl "http://localhost:9000/product-feed?currency_code=INR&country_code=IN&token=<PRODUCT_FEED_TOKEN>"`
4. Validate XML output shape for Meta/Google:
   - Confirm XML response and expected top-level nodes.
5. Run automated tests:
   - `yarn test:unit -- src/api/__tests__/product-feed-route.unit.spec.tsx`
6. Run extraction script smoke test:
   - `npx medusa exec ./src/scripts/test-product-feed-items.ts INR IN`
7. Run XML builder smoke test:
   - `npx medusa exec ./src/scripts/test-product-feed-xml.ts`

## Deployment & Rollout

Production rollout checklist (single DB):
1. Verify `STOREFRONT_URL` is correct for production domain.
2. Confirm Sales Channel named exactly `Feed` exists in Medusa Admin.
3. Assign only 10-20 products to `Feed` for first rollout.
4. Set `ENABLE_PRODUCT_FEED=true` in production environment.
5. Keep `PRODUCT_FEED_TOKEN` secret:
   - do not share in chat/docs/screenshots
   - rotate if exposed
6. Validate feed response from production:
   - `curl -s "https://<api-domain>/product-feed?currency_code=INR&country_code=IN&token=<PRODUCT_FEED_TOKEN>" | xmllint --noout -`
   - expect exit code `0`
7. Submit the same feed URL to Google Merchant Center and Meta Catalog.
8. Monitor diagnostics (Google/Meta ingestion warnings and errors).
9. Gradually add more products to Sales Channel `Feed` in controlled batches.
10. Re-check XML validity and sample PDP links after each batch.

## Troubleshooting

Common issues:
- `FEED_DISABLED`:
  - Set `ENABLE_PRODUCT_FEED=true` and restart.
- `UNAUTHORIZED`:
  - Ensure request token matches `PRODUCT_FEED_TOKEN` exactly.
- `INVALID_QUERY`:
  - Remove unsupported query parameters.
- Empty feed later:
  - Verify products are published and assigned to Sales Channel `Feed`.
- Price appears too high:
  - Usually `PRICES_ARE_MINOR_UNITS` mismatch.
  - For INR paise source amounts, keep `PRICES_ARE_MINOR_UNITS=true`.
  - If source prices are already major units, set it to `false`.
- Broken image URLs:
  - Verify image URLs are publicly reachable (no auth required).
  - Check R2/CDN/public base URL configuration and uploaded asset existence.
  - Open 2-3 sample `g:image_link` URLs directly in browser/curl.
- Invalid XML escaping:
  - Ensure special characters in title/description are escaped (`&`, `<`, `>`, `"`, `'`).
  - Run: `curl -s "<feed-url>" | xmllint --noout -` to confirm.
- Missing storefront URL setup:
  - If `STOREFRONT_URL` is missing/incorrect, links can be wrong or step can fail.
  - Set `STOREFRONT_URL` to production storefront origin and restart server.
