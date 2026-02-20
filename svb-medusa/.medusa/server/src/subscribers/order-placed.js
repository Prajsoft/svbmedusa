"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.createOrderPlacedHandler = createOrderPlacedHandler;
exports.__resetProcessedOrdersForTests = __resetProcessedOrdersForTests;
const utils_1 = require("@medusajs/framework/utils");
const fulfillment_request_1 = require("../workflows/fulfillment_request");
const send_order_confirmation_1 = require("../workflows/send-order-confirmation");
const business_events_1 = require("../modules/logging/business-events");
const correlation_1 = require("../modules/logging/correlation");
const structured_logger_1 = require("../modules/logging/structured-logger");
// Prevent duplicate side-effects if the event fires more than once for the same order.
const processedOrders = new Set();
function getFailureDetails(error) {
    const message = error instanceof Error
        ? error.message
        : typeof error === "string"
            ? error
            : "Unknown fulfillment request failure.";
    const code = error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
        ? error.code
        : "FULFILLMENT_REQUEST_FAILED";
    return { code, message };
}
async function getOrderMetadata(container, orderId) {
    const query = container.resolve(utils_1.ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
        entity: "order",
        fields: ["id", "metadata"],
        filters: { id: orderId },
    });
    const order = Array.isArray(data) ? data[0] : data;
    if (!order || typeof order !== "object") {
        return {};
    }
    const metadata = order.metadata;
    if (!metadata || typeof metadata !== "object") {
        return {};
    }
    return metadata;
}
async function defaultSendOrderConfirmation(container, orderId) {
    await (0, send_order_confirmation_1.sendOrderConfirmationWorkflow)(container).run({
        input: { id: orderId },
    });
}
async function defaultRunFulfillmentRequest(container, orderId) {
    await (0, fulfillment_request_1.fulfillmentRequestWorkflow)(container, {
        order_id: orderId,
        fulfillment_attempt: 1,
        correlation_id: (0, correlation_1.resolveCorrelationId)(),
    });
}
async function defaultMarkFulfillmentPending(container, orderId, failure) {
    const orderModule = container.resolve(utils_1.Modules.ORDER);
    const metadata = await getOrderMetadata(container, orderId);
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
    });
}
async function defaultEmitFulfillmentRequestFailed(container, orderId, failure) {
    await (0, business_events_1.emitBusinessEvent)(container, {
        name: "fulfillment.request_failed",
        workflow_name: "subscriber_order_placed",
        step_name: "emit_event",
        order_id: orderId,
        data: {
            order_id: orderId,
            code: failure.code,
            message: failure.message,
        },
    });
}
function createOrderPlacedHandler(dependencies) {
    const deps = {
        sendOrderConfirmation: defaultSendOrderConfirmation,
        runFulfillmentRequest: defaultRunFulfillmentRequest,
        markFulfillmentPending: defaultMarkFulfillmentPending,
        emitFulfillmentRequestFailed: defaultEmitFulfillmentRequestFailed,
        ...dependencies,
    };
    return async function orderPlacedHandler({ event: { data }, container, }) {
        const orderId = data.id;
        const correlationId = (0, correlation_1.resolveCorrelationId)(data?.correlation_id);
        (0, correlation_1.setCorrelationContext)({
            correlation_id: correlationId,
            workflow_name: "subscriber_order_placed",
            order_id: orderId,
        });
        if (processedOrders.has(orderId)) {
            (0, structured_logger_1.logStructured)(container, "warn", "order.placed duplicate skipped", {
                workflow_name: "subscriber_order_placed",
                step_name: "dedupe",
                order_id: orderId,
            });
            return;
        }
        processedOrders.add(orderId);
        (0, structured_logger_1.logStructured)(container, "info", "order.placed event received", {
            workflow_name: "subscriber_order_placed",
            step_name: "start",
            order_id: orderId,
        });
        await (0, business_events_1.emitBusinessEvent)(container, {
            name: "order.placed",
            workflow_name: "subscriber_order_placed",
            step_name: "emit_event",
            order_id: orderId,
            actor: "system",
            data: {
                order_id: orderId,
            },
        });
        try {
            await deps.sendOrderConfirmation(container, orderId);
            (0, structured_logger_1.logStructured)(container, "info", "Order confirmation email sent", {
                workflow_name: "subscriber_order_placed",
                step_name: "send_confirmation",
                order_id: orderId,
            });
        }
        catch (error) {
            (0, structured_logger_1.logStructured)(container, "error", "Failed to send order confirmation", {
                workflow_name: "subscriber_order_placed",
                step_name: "send_confirmation",
                order_id: orderId,
                error_code: "ORDER_CONFIRMATION_SEND_FAILED",
                meta: {
                    message: error instanceof Error ? error.message : "Unknown error",
                },
            });
        }
        try {
            await deps.runFulfillmentRequest(container, orderId);
            (0, structured_logger_1.logStructured)(container, "info", "Fulfillment request created", {
                workflow_name: "subscriber_order_placed",
                step_name: "fulfillment_request",
                order_id: orderId,
            });
        }
        catch (error) {
            const failure = getFailureDetails(error);
            (0, structured_logger_1.logStructured)(container, "error", "Failed to create fulfillment request", {
                workflow_name: "subscriber_order_placed",
                step_name: "fulfillment_request",
                order_id: orderId,
                error_code: failure.code,
                meta: {
                    message: failure.message,
                },
            });
            try {
                await deps.markFulfillmentPending(container, orderId, failure);
            }
            catch (pendingError) {
                (0, structured_logger_1.logStructured)(container, "error", "Failed to mark fulfillment pending", {
                    workflow_name: "subscriber_order_placed",
                    step_name: "mark_pending",
                    order_id: orderId,
                    error_code: "FULFILLMENT_PENDING_UPDATE_FAILED",
                    meta: {
                        message: pendingError instanceof Error
                            ? pendingError.message
                            : "Unknown error",
                    },
                });
            }
            try {
                await deps.emitFulfillmentRequestFailed(container, orderId, failure);
            }
            catch (alertError) {
                (0, structured_logger_1.logStructured)(container, "error", "Failed to emit fulfillment.request_failed", {
                    workflow_name: "subscriber_order_placed",
                    step_name: "emit_failure_event",
                    order_id: orderId,
                    error_code: "FULFILLMENT_REQUEST_FAILED_EVENT_ERROR",
                    meta: {
                        message: alertError instanceof Error ? alertError.message : "Unknown error",
                    },
                });
            }
        }
        // Clean up after 5 minutes to prevent memory leak.
        setTimeout(() => processedOrders.delete(orderId), 5 * 60 * 1000);
    };
}
function __resetProcessedOrdersForTests() {
    processedOrders.clear();
}
exports.default = createOrderPlacedHandler();
exports.config = {
    event: "order.placed",
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JkZXItcGxhY2VkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3N1YnNjcmliZXJzL29yZGVyLXBsYWNlZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUF1SUEsNERBNkhDO0FBRUQsd0VBRUM7QUF2UUQscURBQThFO0FBQzlFLDBFQUE2RTtBQUM3RSxrRkFBb0Y7QUFDcEYsd0VBQXNFO0FBQ3RFLGdFQUd1QztBQUN2Qyw0RUFBb0U7QUFzQnBFLHVGQUF1RjtBQUN2RixNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFBO0FBRXpDLFNBQVMsaUJBQWlCLENBQUMsS0FBYztJQUN2QyxNQUFNLE9BQU8sR0FDWCxLQUFLLFlBQVksS0FBSztRQUNwQixDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU87UUFDZixDQUFDLENBQUMsT0FBTyxLQUFLLEtBQUssUUFBUTtZQUMzQixDQUFDLENBQUMsS0FBSztZQUNQLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQTtJQUM1QyxNQUFNLElBQUksR0FDUixLQUFLO1FBQ0wsT0FBTyxLQUFLLEtBQUssUUFBUTtRQUN6QixNQUFNLElBQUksS0FBSztRQUNmLE9BQVEsS0FBNEIsQ0FBQyxJQUFJLEtBQUssUUFBUTtRQUNwRCxDQUFDLENBQUcsS0FBMEIsQ0FBQyxJQUFlO1FBQzlDLENBQUMsQ0FBQyw0QkFBNEIsQ0FBQTtJQUVsQyxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxDQUFBO0FBQzFCLENBQUM7QUFFRCxLQUFLLFVBQVUsZ0JBQWdCLENBQzdCLFNBQWMsRUFDZCxPQUFlO0lBRWYsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFDLE9BQU8sQ0FBQyxpQ0FBeUIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUNoRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEdBQUcsTUFBTSxLQUFLLENBQUMsS0FBSyxDQUFDO1FBQ2pDLE1BQU0sRUFBRSxPQUFPO1FBQ2YsTUFBTSxFQUFFLENBQUMs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