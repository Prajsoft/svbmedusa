import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listShippingOptionsForCartWorkflow } from "@medusajs/core-flows"
import { filterShippingOptionsForCart } from "../../../modules/shipping/eligibility"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { cart_id, is_return } = req.filterableFields as {
    cart_id: string
    is_return?: boolean | string
  }

  const workflow = listShippingOptionsForCartWorkflow(req.scope)
  const { result: shipping_options } = await workflow.run({
    input: {
      cart_id,
      is_return: !!is_return,
      fields: req.queryConfig.fields,
    },
  })

  const filtered = await filterShippingOptionsForCart(
    req.scope as any,
    cart_id,
    shipping_options as any[]
  )

  res.json({ shipping_options: filtered })
}
