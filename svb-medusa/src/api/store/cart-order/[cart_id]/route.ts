import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  toApiErrorResponse,
  validationError,
} from "../../../../modules/observability/errors"

/**
 * GET /store/cart-order/:cart_id
 *
 * Looks up the order linked to a cart via the order_cart link table.
 * Used by the storefront to recover order info after a 409 conflict
 * during cart completion (known Medusa v2 workflow engine issue).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { cart_id } = req.params

    if (!cart_id) {
      const mapped = toApiErrorResponse(
        validationError("CART_ID_REQUIRED", "cart_id is required.")
      )
      res.status(mapped.status).json(mapped.body)
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
      const mapped = toApiErrorResponse(
        validationError("ORDER_NOT_FOUND", "No order found for this cart.", {
          httpStatus: 404,
        })
      )
      res.status(mapped.status).json(mapped.body)
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
      const mapped = toApiErrorResponse(
        validationError("ORDER_NOT_FOUND", "Order not found.", {
          httpStatus: 404,
        })
      )
      res.status(mapped.status).json(mapped.body)
      return
    }

    res.json({ order })
  } catch (error) {
    const mapped = toApiErrorResponse(error)
    res.status(mapped.status).json(mapped.body)
  }
}
