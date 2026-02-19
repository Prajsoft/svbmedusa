import { updateCartPromotionsWorkflowId } from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  Modules,
  PromotionActions,
} from "@medusajs/framework/utils"
import { CartCouponWorkflowError } from "./cart_apply_coupon"
import {
  enforcePriceIntegrity,
  PriceIntegrityError,
} from "../modules/promotions/price-integrity"
import { emitBusinessEvent } from "../modules/logging/business-events"
import { setCorrelationContext } from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"

type ScopeLike = {
  resolve: (key: string) => any
}

type NumberLike = number | string | null | undefined

type CartLike = {
  id: string
  total?: NumberLike
  subtotal?: NumberLike
  discount_total?: NumberLike
  shipping_total?: NumberLike
  original_shipping_total?: NumberLike
  items?: Array<{
    id?: string
    subtotal?: NumberLike
    discount_total?: NumberLike
  }> | null
  shipping_methods?: Array<{
    id?: string
    total?: NumberLike
    subtotal?: NumberLike
    discount_total?: NumberLike
    original_total?: NumberLike
    original_subtotal?: NumberLike
  }> | null
}

export type CartRemoveCouponInput = {
  cart_id: string
  code: string
  correlation_id?: string
}

export type CartRemoveCouponResult = {
  cart_id: string
  promo_code: string
  cart: CartLike
}

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase()
}

function mapRemoveCouponError(error: unknown): CartCouponWorkflowError {
  if (error instanceof CartCouponWorkflowError) {
    return error
  }

  if (error instanceof PriceIntegrityError) {
    return new CartCouponWorkflowError(error.code, error.message)
  }

  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === "string" && code.trim()) {
      return new CartCouponWorkflowError(
        code,
        error instanceof Error ? error.message : "Coupon remove failed."
      )
    }
  }

  if (error instanceof Error) {
    return new CartCouponWorkflowError("COUPON_INVALID", error.message)
  }

  return new CartCouponWorkflowError("COUPON_INVALID", "Coupon remove failed.")
}

async function getCart(scope: ScopeLike, cartId: string): Promise<CartLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "total",
      "subtotal",
      "discount_total",
      "shipping_total",
      "original_shipping_total",
      "items.id",
      "items.subtotal",
      "items.discount_total",
      "shipping_methods.id",
      "shipping_methods.total",
      "shipping_methods.subtotal",
      "shipping_methods.discount_total",
      "shipping_methods.original_total",
      "shipping_methods.original_subtotal",
    ],
    filters: { id: cartId },
  })

  const cart = first<CartLike>(data)
  if (!cart) {
    throw new CartCouponWorkflowError(
      "CART_NOT_FOUND",
      `Cart ${cartId} was not found.`
    )
  }

  return cart
}

async function runNativePromotionRemove(
  scope: ScopeLike,
  cartId: string,
  promoCode: string
): Promise<void> {
  const workflowEngine = scope.resolve(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(updateCartPromotionsWorkflowId, {
    input: {
      cart_id: cartId,
      promo_codes: [promoCode],
      action: PromotionActions.REMOVE,
      force_refresh_payment_collection: true,
    },
  })
}

async function emitPromotionRemovedEvent(
  scope: ScopeLike,
  cartId: string,
  promoCode: string,
  correlationId?: string
): Promise<void> {
  await emitBusinessEvent(scope as any, {
    name: "promotion.removed",
    correlation_id: correlationId,
    workflow_name: "cart_remove_coupon",
    step_name: "emit_event",
    cart_id: cartId,
    data: {
      cart_id: cartId,
      promo_code: promoCode,
    },
  })
}

export async function cartRemoveCouponWorkflow(
  scope: ScopeLike,
  input: CartRemoveCouponInput
): Promise<CartRemoveCouponResult> {
  const cartId = input.cart_id?.trim()
  if (!cartId) {
    throw new CartCouponWorkflowError("CART_ID_REQUIRED", "cart_id is required.")
  }

  const promoCode = normalizePromoCode(input.code ?? "")
  if (!promoCode) {
    throw new CartCouponWorkflowError("COUPON_INVALID", "Coupon code is required.")
  }

  setCorrelationContext({
    correlation_id: input.correlation_id,
    workflow_name: "cart_remove_coupon",
    cart_id: cartId,
  })
  logStructured(scope as any, "info", "Removing coupon", {
    workflow_name: "cart_remove_coupon",
    step_name: "start",
    cart_id: cartId,
  })

  try {
    await runNativePromotionRemove(scope, cartId, promoCode)
    const cartAfterRemove = await getCart(scope, cartId)
    enforcePriceIntegrity(cartAfterRemove)
    await emitPromotionRemovedEvent(scope, cartId, promoCode, input.correlation_id)

    return {
      cart_id: cartId,
      promo_code: promoCode,
      cart: cartAfterRemove,
    }
  } catch (error) {
    logStructured(scope as any, "error", "Coupon remove failed", {
      workflow_name: "cart_remove_coupon",
      step_name: "error",
      cart_id: cartId,
      error_code:
        typeof (error as { code?: unknown })?.code === "string"
          ? ((error as { code: string }).code as string)
          : undefined,
      meta: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    })
    throw mapRemoveCouponError(error)
  }
}
