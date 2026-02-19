import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import {
  cartApplyCouponWorkflow,
  CartCouponWorkflowError,
} from "../../../../../workflows/cart_apply_coupon"
import { cartRemoveCouponWorkflow } from "../../../../../workflows/cart_remove_coupon"
import {
  toApiErrorResponse,
  validationError,
} from "../../../../../modules/observability/errors"

function toPromoCodes(payload: unknown): string[] {
  const rawCodes =
    payload && typeof payload === "object" && "promo_codes" in payload
      ? (payload as { promo_codes?: unknown }).promo_codes
      : undefined

  if (!Array.isArray(rawCodes)) {
    return []
  }

  const normalized = rawCodes
    .map((value) => (typeof value === "string" ? value.trim().toUpperCase() : ""))
    .filter(Boolean)

  return Array.from(new Set(normalized))
}

async function refetchCartForStoreResponse(
  req: MedusaRequest,
  cartId: string
): Promise<Record<string, unknown>> {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const fields = req.queryConfig?.fields ?? ["*"]

  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: { filters: { id: cartId } },
    fields,
  })

  const [cart] = await remoteQuery(queryObject)
  if (!cart) {
    throw new CartCouponWorkflowError(
      "CART_NOT_FOUND",
      `Cart ${cartId} was not found.`
    )
  }

  return cart
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const promoCodes = toPromoCodes(req.validatedBody ?? req.body)

  if (promoCodes.length === 0) {
    const mapped = toApiErrorResponse(
      validationError("COUPON_INVALID", "Coupon code is required.")
    )
    res.status(mapped.status).json(mapped.body)
    return
  }

  if (promoCodes.length > 1) {
    const mapped = toApiErrorResponse(
      validationError(
        "COUPON_STACKING_NOT_ALLOWED",
        "Only one manual coupon can be active in v1."
      )
    )
    res.status(mapped.status).json(mapped.body)
    return
  }

  try {
    await cartApplyCouponWorkflow(req.scope as any, {
      cart_id: req.params.id,
      code: promoCodes[0],
      correlation_id: (req as any).correlation_id,
    })

    const cart = await refetchCartForStoreResponse(req, req.params.id)
    res.status(200).json({ cart })
  } catch (error) {
    const mapped = toApiErrorResponse(error, {
      code: "COUPON_INVALID",
      message: "Coupon operation failed.",
      httpStatus: 400,
      category: "validation",
    })
    res.status(mapped.status).json(mapped.body)
  }
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const promoCodes = toPromoCodes(req.validatedBody ?? req.body)

  if (promoCodes.length === 0) {
    const mapped = toApiErrorResponse(
      validationError("COUPON_INVALID", "Coupon code is required.")
    )
    res.status(mapped.status).json(mapped.body)
    return
  }

  try {
    for (const promoCode of promoCodes) {
      await cartRemoveCouponWorkflow(req.scope as any, {
        cart_id: req.params.id,
        code: promoCode,
        correlation_id: (req as any).correlation_id,
      })
    }

    const cart = await refetchCartForStoreResponse(req, req.params.id)
    res.status(200).json({ cart })
  } catch (error) {
    const mapped = toApiErrorResponse(error, {
      code: "COUPON_INVALID",
      message: "Coupon operation failed.",
      httpStatus: 400,
      category: "validation",
    })
    res.status(mapped.status).json(mapped.body)
  }
}
