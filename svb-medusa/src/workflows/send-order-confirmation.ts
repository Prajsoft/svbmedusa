import {
  createWorkflow,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  sendNotificationsStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"

type WorkflowInput = {
  id: string
}

export const sendOrderConfirmationWorkflow = createWorkflow(
  "send-order-confirmation",
  ({ id }: WorkflowInput) => {
    // Step 1: Fetch the order with all fields needed for the email
    const { data: orders } = useQueryGraphStep({
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
    })

    // Step 2: Send notification only if order has an email
    sendNotificationsStep([
      {
        to: orders[0].email as string,
        channel: "email",
        template: "order-placed",
        data: {
          order: orders[0],
        },
      },
    ])

    return new WorkflowResponse({ orderId: id })
  }
)
