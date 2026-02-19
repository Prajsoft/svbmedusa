# No-Backorders Enforcement (Medusa v2)

## Scope

Enforce no-backorders in two places:
1. Cart item add/update (early rejection).
2. Final cart completion / order placement (race-condition safe re-check).

No direct DB queries/writes. Use Medusa workflows and module services only.

## Current request handlers and workflows

### 1) Add items to cart
- Store route handler:
  - `node_modules/@medusajs/medusa/dist/api/store/carts/[id]/line-items/route.js`
  - function: `POST`
- Workflow invoked:
  - `addToCartWorkflowId` (`add-to-cart`)
  - file: `node_modules/@medusajs/core-flows/dist/cart/workflows/add-to-cart.js`

### 2) Update cart item quantity
- Store route handler:
  - `node_modules/@medusajs/medusa/dist/api/store/carts/[id]/line-items/[line_id]/route.js`
  - function: `POST`
- Workflow invoked:
  - `updateLineItemInCartWorkflowId` (`update-line-item-in-cart`)
  - file: `node_modules/@medusajs/core-flows/dist/cart/workflows/update-line-item-in-cart.js`

### 3) Place order (complete cart)
- Store route handler:
  - `node_modules/@medusajs/medusa/dist/api/store/carts/[id]/complete/route.js`
  - function: `POST`
- Workflow invoked:
  - `completeCartWorkflowId` (`complete-cart`)
  - file: `node_modules/@medusajs/core-flows/dist/cart/workflows/complete-cart.js`

## Inventory checks already present in core

### Add/update cart checks
- Workflow used by both add/update:
  - `confirmVariantInventoryWorkflow`
  - file: `node_modules/@medusajs/core-flows/dist/cart/workflows/confirm-variant-inventory.js`
- Core step that executes availability check:
  - `confirmInventoryStep`
  - file: `node_modules/@medusajs/core-flows/dist/cart/steps/confirm-inventory.js`
  - function uses:
    - `inventoryService.confirmInventory(inventory_item_id, location_ids, quantity)`
    - from `container.resolve(Modules.INVENTORY)`

### Final placement re-check and reservation
- In `completeCartWorkflow`:
  - inventory input prepared from order/cart lines via `prepareConfirmInventoryInput`
  - file: `node_modules/@medusajs/core-flows/dist/cart/utils/prepare-confirm-inventory-input.js`
  - then inventory is reserved using `reserveInventoryStep`
  - file: `node_modules/@medusajs/core-flows/dist/cart/steps/reserve-inventory.js`
  - reservation uses:
    - `inventoryService.createReservationItems(...)`
    - wrapped in locking module to reduce race conditions.

## Recommended enforcement points

### A) Add/update cart items (early rejection)
Enforce on Store cart mutation routes before workflow proceeds:
- `POST /store/carts/:id/line-items`
- `POST /store/carts/:id/line-items/:line_id`

Preferred integration point in this repo:
- `src/api/middlewares.ts` (route middleware)

Reason:
- Centralized server-side guard.
- Reject invalid no-backorder attempts with clear 4xx before deeper workflow execution.
- Still keep core `confirmVariantInventoryWorkflow -> confirmInventoryStep` as authoritative inventory check.

### B) Final order placement (race-condition safe)
Enforce at cart completion path:
- `POST /store/carts/:id/complete`
- via `completeCartWorkflow` inventory reservation phase (`reserveInventoryStep`).

Reason:
- This is the last safe server-side gate before order finalization.
- Reservation under lock is the correct anti-race mechanism.

## How to retrieve availability (module services only)

Use inventory module service from DI container:
- `const inventoryService = container.resolve(Modules.INVENTORY)`

Supported methods (type contract):
- `confirmInventory(inventoryItemId, locationIds, quantity)` -> boolean
- `retrieveAvailableQuantity(inventoryItemId, locationIds)` -> available qty

Reference:
- `node_modules/@medusajs/types/dist/inventory/service.d.ts`

## Practical policy for “no backorders”

For cart add/update:
- Reject when available quantity is insufficient.
- Ignore/deny payloads that attempt to bypass availability through backorder semantics.

For order placement:
- Always rely on final reservation (`reserveInventoryStep`) as mandatory re-check.
- If reservation fails, return conflict/not-allowed style error and do not place order.
