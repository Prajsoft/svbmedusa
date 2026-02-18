# Returns, Exchanges, Refunds, and RTO v1

## Purpose

Define a stable, carrier-agnostic contract for returns, exchanges, refunds, and RTO handling in SVB Medusa workflows.

## Scope

- Policy and state contract only.
- No carrier-specific implementation in this document.
- No runtime workflow changes in this step.

## A) Eligibility Policy (v1 placeholders)

- Return window (days): `TBD_RETURN_WINDOW_DAYS` (placeholder until policy freeze).
- Exchange window (days): `TBD_EXCHANGE_WINDOW_DAYS` (placeholder until policy freeze).
- Non-returnable categories/tags: `TBD_NON_RETURNABLE_RULES` (future: category/tag-based blocklist).
- Condition requirements:
  - item should be unused
  - item should be in original condition/packaging
  - mandatory accessories/inserts should be present
  - unopened requirement can be enforced per SKU/category policy later

## B) Return Reasons Taxonomy (fixed codes)

- `SIZE_ISSUE`
- `DEFECTIVE`
- `WRONG_ITEM`
- `CHANGED_MIND`
- `DAMAGED_IN_TRANSIT`
- `OTHER`

These codes are canonical for storage, analytics, and workflow branching.

## C) State Machines

### Return

`requested -> approved -> pickup_scheduled (optional) -> received -> qc_passed | qc_failed -> refunded | closed`

Transition intent:
- `requested`: customer initiated return request.
- `approved`: return accepted by policy/ops.
- `pickup_scheduled` (optional): reverse pickup arranged.
- `received`: returned unit physically received at warehouse.
- `qc_passed`: quality check passed.
- `qc_failed`: quality check failed.
- `refunded`: refund completed/recorded.
- `closed`: terminal closed state (non-refundable failure or completion path closure).

### Exchange

`requested -> approved -> return_received -> replacement_reserved -> replacement_shipped -> delivered -> closed`

Transition intent:
- `requested`: customer initiated exchange request.
- `approved`: exchange accepted by policy/ops.
- `return_received`: original item received.
- `replacement_reserved`: replacement inventory reserved.
- `replacement_shipped`: replacement dispatched.
- `delivered`: replacement delivered.
- `closed`: terminal closure.

### RTO

`delivery_failed -> rto_initiated -> rto_received -> qc_passed | qc_failed -> restocked | closed`

Transition intent:
- `delivery_failed`: forward delivery failed.
- `rto_initiated`: return-to-origin started.
- `rto_received`: RTO parcel received at origin warehouse.
- `qc_passed`: item condition acceptable.
- `qc_failed`: item not suitable for sale.
- `restocked`: inventory returned to sellable stock.
- `closed`: terminal closure without restock.

## D) Inventory Rules

- Returns are **not restocked** until `qc_passed`.
- `qc_failed` inventory must move to non-sellable bucket (`DAMAGE` / `WRITE_OFF`) and must not be sold.

## E) COD and Prepaid Refund Rules

- COD refunds:
  - handled as **manual refund record** (already supported in backend).
  - no external payout API required in v1 contract.
- Prepaid refunds:
  - to be handled later via payment provider refund workflow.
  - must remain auditable and idempotent.

## F) Required Audit Events

Return events:
- `return.requested`
- `return.approved`
- `return.received`
- `return.qc_passed`
- `return.qc_failed`

Exchange events:
- `exchange.requested`
- `exchange.approved`
- `exchange.shipped`
- `exchange.closed`

RTO events:
- `rto.initiated`
- `rto.received`
- `rto.qc_passed`
- `rto.qc_failed`

## Operational Notes

- Every transition should be idempotent per request/action key.
- Every transition should carry actor and timestamp for audit.
- Carrier and payment provider integrations should plug into this state contract without changing state names.
