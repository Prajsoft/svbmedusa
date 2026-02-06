"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendOrderConfirmationWorkflow = void 0;
const workflows_sdk_1 = require("@medusajs/framework/workflows-sdk");
const core_flows_1 = require("@medusajs/medusa/core-flows");
exports.sendOrderConfirmationWorkflow = (0, workflows_sdk_1.createWorkflow)("send-order-confirmation", ({ id }) => {
    // Step 1: Fetch the order with all fields needed for the email
    const { data: orders } = (0, core_flows_1.useQueryGraphStep)({
        entity: "order",
        fields: [
            "id",
            "display_id",
            "email",
            "currency_code",
            "total",
            "subtotal",
            "shipping_total",
            "tax_total",
            "discount_total",
            "items.*",
            "shipping_address.*",
            "billing_address.*",
            "shipping_methods.*",
        ],
        filters: { id },
        options: {
            throwIfKeyNotFound: true,
        },
    });
    // Step 2: Send notification only if order has an email
    (0, core_flows_1.sendNotificationsStep)([
        {
            to: orders[0].email,
            channel: "email",
            template: "order-placed",
            data: {
                order: orders[0],
            },
        },
    ]);
    return new workflows_sdk_1.WorkflowResponse({ orderId: id });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VuZC1vcmRlci1jb25maXJtYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvd29ya2Zsb3dzL3NlbmQtb3JkZXItY29uZmlybWF0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHFFQUkwQztBQUMxQyw0REFHb0M7QUFNdkIsUUFBQSw2QkFBNkIsR0FBRyxJQUFBLDhCQUFjLEVBQ3pELHlCQUF5QixFQUN6QixDQUFDLEVBQUUsRUFBRSxFQUFpQixFQUFFLEVBQUU7SUFDeEIsK0RBQStEO0lBQy9ELE1BQU0sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLEdBQUcsSUFBQSw4QkFBaUIsRUFBQztRQUN6QyxNQUFNLEVBQUUsT0FBTztRQUNmLE1BQU0sRUFBRTtZQUNOLElBQUk7WUFDSixZQUFZO1lBQ1osT0FBTztZQUNQLGVBQWU7WUFDZixPQUFPO1lBQ1AsVUFBVTtZQUNWLGdCQUFnQjtZQUNoQixXQUFXO1lBQ1gsZ0JBQWdCO1lBQ2hCLFNBQVM7WUFDVCxvQkFBb0I7WUFDcEIsbUJBQW1CO1lBQ25CLG9CQUFvQjtTQUNyQjtRQUNELE9BQU8sRUFBRSxFQUFFLEVBQUUsRUFBRTtRQUNmLE9BQU8sRUFBRTtZQUNQLGtCQUFrQixFQUFFLElBQUk7U0FDekI7S0FDRixDQUFDLENBQUE7SUFFRix1REFBdUQ7SUFDdkQsSUFBQSxrQ0FBcUIsRUFBQztRQUNwQjtZQUNFLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBZTtZQUM3QixPQUFPLEVBQUUsT0FBTztZQUNoQixRQUFRLEVBQUUsY0FBYztZQUN4QixJQUFJLEVBQUU7Z0JBQ0osS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUM7YUFDakI7U0FDRjtLQUNGLENBQUMsQ0FBQTtJQUVGLE9BQU8sSUFBSSxnQ0FBZ0IsQ0FBQyxFQUFFLE9BQU8sRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFBO0FBQzlDLENBQUMsQ0FDRixDQUFBIn0=