import { updateCartPromotionsWorkflowId } from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  Modules,
  PromotionActions,
} from "@medusajs/framework/utils"
import {
  ensureCouponStackingAllowed,
  PromoGuardError,
} from "../modules/promotions/promo-guards"
import {
  enforcePriceIntegrity,
  PriceIntegrityError,
} from "../modules/promotions/price-integrity"
import { emitBusinessEvent } from "../modules/logging/business-events"
import { setCorrelationContext } from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"
import { increment } from "../modules/observability/metrics"

type ScopeLike = {
  resolve: (key: string) => any
}

type NumberLike = number | string | null | undefined

type CartLike = {
  id: string
  coupon_code?: string | null
  promotions?: Array<{ code?: string | null } & Record<string, unknown>> | null
  discount_codes?: Array<{ code?: string | null } & Record<string, unknown>> | null
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

type PromotionActionLike = typeof PromotionActions.ADD | typeof PromotionActions.REMOVE

export type CartApplyCouponInput = {
  cart_id: string
  code: string
  correlation_id?: string
}

export type CartApplyCouponResult = {
  cart_id: string
  promo_code: string
  cart: CartLike
}

export class CartCouponWorkflowError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "CartCouponWorkflowError"
    this.code = code
  }
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

function hasExistingCouponCode(cart: CartLike, promoCode: string): boolean {
  const normalized = normalizePromoCode(promoCode)
  if (!normalized) {
    return false
  }

  if (normalizePromoCode(cart.coupon_code ?? "") === normalized) {
    return true
  }

  const inDiscountCodes = (cart.discount_codes ?? []).some(
    (entry) => normalizePromoCode(entry.code ?? "") === normalized
  )

  if (inDiscountCodes) {
    return true
  }

  return (cart.promotions ?? []).some(
    (entry) => normalizePromoCode(entry.code ?? "") === normalized
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Coupon operation failed."
}

function extractErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code.trim()
    return code || undefined
  }

  return undefined
}

function mapMedusaCouponError(error: unknown): CartCouponWorkflowError {
  if (
    error instanceof CartCouponWorkflowError ||
    error instanceof PromoGuardError ||
    error instanceof PriceIntegrityError
  ) {
    return new CartCouponWorkflowError(
      (error as { code: string }).code,
      (error as Error).message
    )
  }

  const codeFromError =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined

  if (typeof codeFromError === "string" && codeFromError.trim()) {
    return new CartCouponWorkflowError(codeFromError, getErrorMessage(error))
  }

  const message = getErrorMessage(error)

  if (/expired|has expired/i.test(message)) {
    return new CartCouponWorkflowError("COUPON_EXPIRED", message)
  }

  if (/not started|hasn't started|not yet active/i.test(message)) {
    return new CartCouponWorkflowError("COUPON_NOT_STARTED", message)
  }

  if (/minimum|min cart|min subtotal|min spend|min order/i.test(message)) {
    return new CartCouponWorkflowError("COUPON_MIN_CART_NOT_MET", message)
  }

  if (/usage limit|max uses|redemption limit|limit reached/i.test(message)) {
    return new CartCouponWorkflowError("COUPON_USAGE_LIMIT_REACHED", message)
  }

  if (/stack|combine|multiple coupon|manual coupon/i.test(message)) {
    return new CartCouponWorkflowError("COUPON_STACKING_NOT_ALLOWED", message)
  }

  return new CartCouponWorkflowError("COUPON_INVALID", message)
}

async function getCart(scope: ScopeLike, cartId: string): Promise<CartLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "coupon_code",
      "promotions.code",
      "promotions.is_automatic",
      "promotions.type",
      "promotions.target_type",
      "promotions.metadata",
      "discount_codes.code",
      "discount_codes.is_automatic",
      "discount_codes.type",
      "discount_codes.target_type",
      "discount_codes.metadata",
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

async function runNativePromotionAction(
  scope: ScopeLike,
  input: {
    cart_id: string
    promo_code: string
    action: PromotionActionLike
  }
): Promise<void> {
  const workflowEngine = scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(updateCartPromotionsWorkflowId, {
    input: {
      cart_id: input.cart_id,
      promo_codes: [input.promo_code],
      action: input.action,
      force_refresh_payment_collection: true,
    },
  })
}

async function emitPromotionAppliedEvent(
  scope: ScopeLike,
  cartId: string,
  promoCode: string,
  correlationId?: string
): Promise<void> {
  await emitBusinessEvent(scope as any, {
    name: "promotion.applied",
    correlation_id: correlationId,
    workflow_name: "cart_apply_coupon",
    step_name: "emit_event",
    cart_id: cartId,
    data: {
      cart_id: cartId,
      promo_code: promoCode,
    },
  })
}

export async function cartApplyCouponWorkflow(
  scope: ScopeLike,
  input: CartApplyCouponInput
): Promise<CartApplyCouponResult> {
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
    workflow_name: "cart_apply_coupon",
    cart_id: cartId,
  })
  logStructured(scope as any, "info", "Applying coupon", {
    workflow_name: "cart_apply_coupon",
    step_name: "start",
    cart_id: cartId,
  })

  let outcome: "success" | "failure" = "failure"
  let failureCode: string | undefined

  try {
    const cartBeforeApply = await getCart(scope, cartId)
    ensureCouponStackingAllowed(cartBeforeApply, promoCode)

    if (hasExistingCouponCode(cartBeforeApply, promoCode)) {
      enforcePriceIntegrity(cartBeforeApply)
      outcome = "success"
      return {
        cart_id: cartId,
        promo_code: promoCode,
        cart: cartBeforeApply,
      }
    }

    await runNativePromotionAction(scope, {
      cart_id: cartId,
      promo_code: promoCode,
      action: PromotionActions.ADD,
    })

    const cartAfterApply = await getCart(scope, cartId)
    enforcePriceIntegrity(cartAfterApply)

    await emitPromotionAppliedEvent(scope, cartId, promoCode, input.correlation_id)

    outcome = "success"
    return {
      cart_id: cartId,
      promo_code: promoCode,
      cart: cartAfterApply,
    }
  } catch (error) {
    const mappedError = mapMedusaCouponError(error)
    failureCode = mappedError.code || extractErrorCode(error)

    logStructured(scope as any, "error", "Coupon apply failed", {
      workflow_name: "cart_apply_coupon",
      step_name: "error",
      cart_id: cartId,
      error_code: failureCode,
      meta: {
        message: mappedError.message,
      },
    })
    throw mappedError
  } finally {
    increment(`workflow.coupon_apply.${outcome}_total`, {
      workflow: "coupon_apply",
      result: outcome,
      ...(failureCode ? { error_code: failureCode } : {}),
    })
  }
}
