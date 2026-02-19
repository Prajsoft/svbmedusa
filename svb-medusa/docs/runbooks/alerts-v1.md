# Alerts Runbook (V1)

## Event Contract

All ops detectors raise the business event:

- `ops.alert.raised`

Event payload:

- `type`
- `severity`
- `entity_id`
- `reason`
- `suggested_action`

## Alert Types

### `stuck_fulfillment`

- Severity: `high`
- Meaning: An order fulfillment intent is still in `requested` state beyond the configured threshold.
- Suggested action: Check fulfillment blockers and move intent to `ready_for_shipment` when valid.

### `cod_capture_pending`

- Severity: `high`
- Meaning: Order is delivered but COD payment is not captured after the configured threshold.
- Suggested action: Verify delivered status and run COD capture admin operation.

### `returns_qc_stuck`

- Severity: `medium`
- Meaning: Return is in `received` state beyond the configured threshold with no QC pass/fail outcome.
- Suggested action: Run return QC pass/fail workflow and complete return closure.

## Scheduled Jobs

- `stuck-fulfillment-detector`
- `cod-capture-pending-detector`
- `returns-qc-stuck-detector`

## Configuration

Threshold env vars:

- `OPS_STUCK_FULFILLMENT_THRESHOLD_MINUTES` (default: `30`)
- `OPS_COD_CAPTURE_PENDING_THRESHOLD_DAYS` (default: `3`)
- `OPS_RETURNS_QC_STUCK_THRESHOLD_DAYS` (default: `2`)

Cron overrides:

- `OPS_STUCK_FULFILLMENT_DETECTOR_CRON` (default: `*/15 * * * *`)
- `OPS_COD_CAPTURE_PENDING_DETECTOR_CRON` (default: `0 */6 * * *`)
- `OPS_RETURNS_QC_STUCK_DETECTOR_CRON` (default: `0 */6 * * *`)
