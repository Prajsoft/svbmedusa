import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { fulfillmentRequestWorkflow } from "../workflows/fulfillment_request"
import { sendOrderConfirmationWorkflow } from "../workflows/send-order-confirmation"
import { emitBusinessEvent } from "../modules/logging/business-events"
import {
  resolveCorrelationId,
  setCorrelationContext,
} from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"

type FulfillmentFailureDetails = {
  code: string
  message: string
}

type OrderPlacedDependencies = {
  sendOrderConfirmation: (container: any, orderId: string) => Promise<void>
  runFulfillmentRequest: (container: any, orderId: string) => Promise<void>
  markFulfillmentPending: (
    container: any,
    orderId: string,
    failure: FulfillmentFailureDetails
  ) => Promise<void>
  emitFulfillmentRequestFailed: (
    container: any,
    orderId: string,
    failure: FulfillmentFailureDetails
  ) => Promise<void>
}

// Prevent duplicate side-effects if the event fires more than once for the same order.
const processedOrders = new Set<string>()

function getFailureDetails(error: unknown): FulfillmentFailureDetails {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "Unknown fulfillment request failure."
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? ((error as { code: string }).code as string)
      : "FULFILLMENT_REQUEST_FAILED"

  return { code, message }
}

async function getOrderMetadata(
  container: any,
  orderId: string
): Promise<Record<string, unknown>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: orderId },
  })

  const order = Array.isArray(data) ? data[0] : data
  if (!order || typeof order !== "object") {
    return {}
  }

  const metadata = (order as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object") {
    return {}
  }

  return metadata as Record<string, unknown>
}

async function defaultSendOrderConfirmation(
  container: any,
  orderId: string
): Promise<void> {
  await sendOrderConfirmationWorkflow(container).run({
    input: { id: orderId },
  })
}

async function defaultRunFulfillmentRequest(
  container: any,
  orderId: string
): Promise<void> {
  await fulfillmentRequestWorkflow(container, {
    order_id: orderId,
    fulfillment_attempt: 1,
    correlation_id: resolveCorrelationId(),
  })
}

async function defaultMarkFulfillmentPending(
  container: any,
  orderId: string,
  failure: FulfillmentFailureDetails
): Promise<void> {
  const orderModule = container.resolve(Modules.ORDER)
  const metadata = await getOrderMetadata(container, orderId)

  await orderModule.updateOrders(orderId, {
    metadata: {
      ...metadata,
      fulfillment_state_v1: "pending",
      fulfillment_last_error_v1: {
        code: failure.code,
        message: failure.message,
        at: new Date().toISOString(),
      },
    },
  })
}

async function defaultEmitFulfillmentRequestFailed(
  container: any,
  orderId: string,
  failure: FulfillmentFailureDetails
): Promise<void> {
  await emitBusinessEvent(container, {
    name: "fulfillment.request_failed",
    workflow_name: "subscriber_order_placed",
    step_name: "emit_event",
    order_id: orderId,
    data: {
      order_id: orderId,
      code: failure.code,
      message: failure.message,
    },
  })
}

export function createOrderPlacedHandler(
  dependencies?: Partial<OrderPlacedDependencies>
) {
  const deps: OrderPlacedDependencies = {
    sendOrderConfirmation: defaultSendOrderConfirmation,
    runFulfillmentRequest: defaultRunFulfillmentRequest,
    markFulfillmentPending: defaultMarkFulfillmentPending,
    emitFulfillmentRequestFailed: defaultEmitFulfillmentRequestFailed,
    ...dependencies,
  }

  return async function orderPlacedHandler({
    event: { data },
    container,
  }: SubscriberArgs<{ id: string }>) {
    const orderId = data.id
    const correlationId = resolveCorrelationId((data as { correlation_id?: string })?.correlation_id)

    setCorrelationContext({
      correlation_id: correlationId,
      workflow_name: "subscriber_order_placed",
      order_id: orderId,
    })

    if (processedOrders.has(orderId)) {
      logStructured(container, "warn", "order.placed duplicate skipped", {
        workflow_name: "subscriber_order_placed",
        step_name: "dedupe",
        order_id: orderId,
      })
      return
    }

    processedOrders.add(orderId)
    logStructured(container, "info", "order.placed event received", {
      workflow_name: "subscriber_order_placed",
      step_name: "start",
      order_id: orderId,
    })

    await emitBusinessEvent(container, {
      name: "order.placed",
      workflow_name: "subscriber_order_placed",
      step_name: "emit_event",
      order_id: orderId,
      actor: "system",
      data: {
        order_id: orderId,
      },
    })

    try {
      await deps.sendOrderConfirmation(container, orderId)
      logStructured(container, "info", "Order confirmation email sent", {
        workflow_name: "subscriber_order_placed",
        step_name: "send_confirmation",
        order_id: orderId,
      })
    } catch (error) {
      logStructured(container, "error", "Failed to send order confirmation", {
        workflow_name: "subscriber_order_placed",
        step_name: "send_confirmation",
        order_id: orderId,
        error_code: "ORDER_CONFIRMATION_SEND_FAILED",
        meta: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })
    }

    try {
      await deps.runFulfillmentRequest(container, orderId)
      logStructured(container, "info", "Fulfillment request created", {
        workflow_name: "subscriber_order_placed",
        step_name: "fulfillment_request",
        order_id: orderId,
      })
    } catch (error) {
      const failure = getFailureDetails(error)
      logStructured(container, "error", "Failed to create fulfillment request", {
        workflow_name: "subscriber_order_placed",
        step_name: "fulfillment_request",
        order_id: orderId,
        error_code: failure.code,
        meta: {
          message: failure.message,
        },
      })

      try {
        await deps.markFulfillmentPending(container, orderId, failure)
      } catch (pendingError) {
        logStructured(container, "error", "Failed to mark fulfillment pending", {
          workflow_name: "subscriber_order_placed",
          step_name: "mark_pending",
          order_id: orderId,
          error_code: "FULFILLMENT_PENDING_UPDATE_FAILED",
          meta: {
            message:
              pendingError instanceof Error
                ? pendingError.message
                : "Unknown error",
          },
        })
      }

      try {
        await deps.emitFulfillmentRequestFailed(container, orderId, failure)
      } catch (alertError) {
        logStructured(container, "error", "Failed to emit fulfillment.request_failed", {
          workflow_name: "subscriber_order_placed",
          step_name: "emit_failure_event",
          order_id: orderId,
          error_code: "FULFILLMENT_REQUEST_FAILED_EVENT_ERROR",
          meta: {
            message:
              alertError instanceof Error ? alertError.message : "Unknown error",
          },
        })
      }
    }

    // Clean up after 5 minutes to prevent memory leak.
    setTimeout(() => processedOrders.delete(orderId), 5 * 60 * 1000)
  }
}

export function __resetProcessedOrdersForTests(): void {
  processedOrders.clear()
}

export default createOrderPlacedHandler()

export const config: SubscriberConfig = {
  event: "order.placed",
}
