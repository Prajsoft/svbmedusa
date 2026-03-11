import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  transitionFulfillmentStatusWorkflow,
  FulfillmentStatusTransitionError,
  type TransitionFulfillmentStatusInput,
} from "../workflows/fulfillment-status"
import { resolveCorrelationId, setCorrelationContext } from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"
import { ShipmentStatus } from "../integrations/carriers/provider-contract"

type FulfillmentStatus = TransitionFulfillmentStatusInput["to_status"]

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toPositiveInt(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1
}

// Map Shiprocket ShipmentStatus → internal FulfillmentStatus
const STATUS_MAP: Partial<Record<ShipmentStatus, FulfillmentStatus>> = {
  [ShipmentStatus.BOOKED]: "ready_for_shipment",
  [ShipmentStatus.PICKUP_SCHEDULED]: "ready_for_shipment",
  [ShipmentStatus.IN_TRANSIT]: "shipped",
  [ShipmentStatus.OFD]: "shipped",
  [ShipmentStatus.DELIVERED]: "delivered",
  [ShipmentStatus.FAILED]: "delivery_failed",
  [ShipmentStatus.CANCELLED]: "delivery_failed",
  [ShipmentStatus.RTO_INITIATED]: "rto_initiated",
  [ShipmentStatus.RTO_IN_TRANSIT]: "rto_initiated",
  [ShipmentStatus.RTO_DELIVERED]: "rto_delivered",
}

// Forward cascade path for skipping intermediate steps when webhooks arrive
// out of order or after a processing delay.
// e.g. if state is "requested" and we receive DELIVERED, we apply:
//   requested → ready_for_shipment → shipped → delivered
const FORWARD_CASCADE: FulfillmentStatus[] = [
  "ready_for_shipment",
  "shipped",
  "delivered",
]

function getCascadeTargets(targetStatus: FulfillmentStatus): FulfillmentStatus[] {
  const idx = FORWARD_CASCADE.indexOf(targetStatus)
  if (idx === -1) {
    // rto_initiated, rto_delivered, delivery_failed — attempt direct transition
    return [targetStatus]
  }
  // Include all steps up to and including targetStatus so that gaps are filled
  return FORWARD_CASCADE.slice(0, idx + 1)
}

type ShippingStatusUpdatedDependencies = {
  transition: (
    scope: unknown,
    input: TransitionFulfillmentStatusInput
  ) => Promise<unknown>
}

export function createShippingStatusUpdatedHandler(
  dependencies?: Partial<ShippingStatusUpdatedDependencies>
) {
  const deps: ShippingStatusUpdatedDependencies = {
    transition: transitionFulfillmentStatusWorkflow,
    ...dependencies,
  }

  return async function shippingStatusUpdatedSubscriber({
    event,
    container,
  }: SubscriberArgs<Record<string, unknown>>) {
    const data = (event?.data ?? {}) as Record<string, unknown>
    const orderId = readText(data.order_id)
    const newStatus = readText(data.new_status) as ShipmentStatus
    const fulfillmentAttempt = toPositiveInt(data.fulfillment_attempt)
    const correlationId = resolveCorrelationId(
      readText(data.correlation_id) || undefined
    )

    if (!orderId || !newStatus) {
      return
    }

    const targetFulfillmentStatus = STATUS_MAP[newStatus]
    if (!targetFulfillmentStatus) {
      logStructured(container as any, "info", "shipping.status_updated ignored: no fulfillment mapping", {
        workflow_name: "subscriber_shipping_status_updated",
        step_name: "skip",
        order_id: orderId,
        meta: { new_status: newStatus },
      })
      return
    }

    setCorrelationContext({
      correlation_id: correlationId,
      workflow_name: "subscriber_shipping_status_updated",
      order_id: orderId,
    })

    logStructured(container as any, "info", "processing shipping status update", {
      workflow_name: "subscriber_shipping_status_updated",
      step_name: "start",
      order_id: orderId,
      meta: {
        new_status: newStatus,
        target_fulfillment_status: targetFulfillmentStatus,
        fulfillment_attempt: fulfillmentAttempt,
      },
    })

    const targets = getCascadeTargets(targetFulfillmentStatus)

    for (const status of targets) {
      try {
        await deps.transition(container, {
          order_id: orderId,
          to_status: status,
          fulfillment_attempt: fulfillmentAttempt,
          actor_id: "shipping_webhook",
          reason: `Shiprocket webhook: ${newStatus}`,
          correlation_id: correlationId,
        })
      } catch (err) {
        if (err instanceof FulfillmentStatusTransitionError) {
          if (err.code === "FULFILLMENT_INTENT_NOT_FOUND") {
            // Order has no fulfillment intent tracked — skip silently.
            // This can happen for orders fulfilled outside this system.
            logStructured(container as any, "info", "shipping status update skipped: no fulfillment intent", {
              workflow_name: "subscriber_shipping_status_updated",
              step_name: "skip",
              order_id: orderId,
              meta: { to_status: status },
            })
            return
          }

          if (err.code === "INVALID_FULFILLMENT_STATUS_TRANSITION") {
            // State machine rejected this step — the order is already past it.
            // Continue to the next cascade step.
            logStructured(container as any, "info", "shipping status cascade step skipped: already past this state", {
              workflow_name: "subscriber_shipping_status_updated",
              step_name: "cascade_skip",
              order_id: orderId,
              meta: { to_status: status, new_status: newStatus },
            })
            continue
          }
        }

        // Unexpected error — surface it
        logStructured(container as any, "error", "shipping status update failed", {
          workflow_name: "subscriber_shipping_status_updated",
          step_name: "transition",
          order_id: orderId,
          error_code:
            err instanceof FulfillmentStatusTransitionError ? err.code : "UNKNOWN",
          meta: {
            to_status: status,
            new_status: newStatus,
            message: err instanceof Error ? err.message : String(err),
          },
        })
        throw err
      }
    }

    logStructured(container as any, "info", "shipping status update complete", {
      workflow_name: "subscriber_shipping_status_updated",
      step_name: "done",
      order_id: orderId,
      meta: {
        new_status: newStatus,
        target_fulfillment_status: targetFulfillmentStatus,
        fulfillment_attempt: fulfillmentAttempt,
      },
    })
  }
}

export default createShippingStatusUpdatedHandler()

export const config: SubscriberConfig = {
  event: "shipping.status_updated",
}
