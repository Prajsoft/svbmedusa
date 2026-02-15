import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/cart-order/:cart_id
 *
 * Looks up the order linked to a cart via the order_cart link table.
 * Used by the storefront to recover order info after a 409 conflict
 * during cart completion (known Medusa v2 workflow engine issue).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { cart_id } = req.params

  if (!cart_id) {
    res.status(400).json({ message: "cart_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "order_cart",
    fields: ["order_id"],
    filters: { cart_id },
  })

  const orderId = data?.[0]?.order_id

  if (!orderId) {
    res.status(404).json({ message: "No order found for this cart" })
    return
  }

  // Fetch the order with shipping address for redirect
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "shipping_address.country_code"],
    filters: { id: orderId },
  })

  const order = orders?.[0]

  if (!order) {
    res.status(404).json({ message: "Order not found" })
    return
  }

  res.json({ order })
}
