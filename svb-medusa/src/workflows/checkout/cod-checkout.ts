import {
  ContainerRegistrationKeys,
  Modules,
  PromotionActions,
} from "@medusajs/framework/utils"
import { isCodOption } from "../../modules/shipping/eligibility"
import {
  enforcePriceIntegrity,
  PriceIntegrityError,
} from "../../modules/promotions/price-integrity"
import { updateCartPromotionsWorkflowId } from "@medusajs/core-flows"
import {
  ensureCouponStackingAllowed,
  PromoGuardError,
} from "../../modules/promotions/promo-guards"
import { emitBusinessEvent } from "../../modules/logging/business-events"
import { setCorrelationContext } from "../../modules/logging/correlation"
import { logStructured } from "../../modules/logging/structured-logger"
import { increment, observeDuration } from "../../modules/observability/metrics"

type ScopeLike = {
  resolve: (key: string) => any
}

type ShippingMethodLike = {
  shipping_option_id?: string
  shipping_option?: {
    id?: string
    name?: string | null
    code?: string | null
    type?: { code?: string | null; label?: string | null } | null
    metadata?: Record<string, unknown> | null
  } | null
}

type CartLike = {
  id: string
  grand_total?: number
  total?: number
  subtotal?: number
  discount_total?: number
  shipping_total?: number
  original_shipping_total?: number
  shipping_discount_total?: number
  payment_collection?: {
    id?: string
    amount?: number
    currency_code?: string
    payment_sessions?: Array<{
      id?: string
      provider_id?: string
      status?: string
    }>
  } | null
  coupon_code?: string | null
  promotions?: Array<{
    code?: string | null
    is_automatic?: boolean | null
    type?: string | null
    target_type?: string | null
    metadata?: Record<string, unknown> | null
  }> | null
  discount_codes?: Array<{
    code?: string | null
    is_automatic?: boolean | null
    type?: string | null
    target_type?: string | null
    metadata?: Record<string, unknown> | null
  }> | null
  shipping_methods?: Array<
    ShippingMethodLike & {
      total?: number
      subtotal?: number
      discount_total?: number
      original_total?: number
      original_subtotal?: number
    }
  >
}

type PaymentInitResult =
  | { skipped: true; reason: "not_cod" }
  | { skipped: false; payment_session_id: string }

type PaymentAuthorizeResult =
  | { skipped: true; reason: "not_cod" }
  | {
      skipped: false
      payment_session_id: string
      already_authorized: boolean
    }

export class CheckoutPaymentError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "CheckoutPaymentError"
    this.code = code
  }
}

export const COD_PAYMENT_PROVIDER_ID = "pp_cod_cod"

function first<T>(value: T[] | T | null | undefined): T | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

function isAuthorizedStatus(value: unknown): boolean {
  if (typeof value !== "string") {
    return false
  }

  return value === "authorized" || value === "captured"
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function normalizeCode(code: unknown): string {
  return typeof code === "string" ? code.trim().toUpperCase() : ""
}

function nowMs(): number {
  return Date.now()
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

function getManualPromoCodes(cart: CartLike): string[] {
  const codes = new Set<string>()
  const couponCode = normalizeCode(cart.coupon_code)

  if (couponCode) {
    codes.add(couponCode)
  }

  for (const discountCode of cart.discount_codes ?? []) {
    if (discountCode.is_automatic === true) {
      continue
    }
    const code = normalizeCode(discountCode.code)
    if (code) {
      codes.add(code)
    }
  }

  for (const promotion of cart.promotions ?? []) {
    if (promotion.is_automatic === true) {
      continue
    }
    const code = normalizeCode(promotion.code)
    if (code) {
      codes.add(code)
    }
  }

  return Array.from(codes)
}

function mapPromotionError(error: unknown): CheckoutPaymentError {
  if (error instanceof CheckoutPaymentError) {
    return error
  }

  if (error instanceof PromoGuardError) {
    return new CheckoutPaymentError(error.code, error.message)
  }

  if (error instanceof PriceIntegrityError) {
    return new CheckoutPaymentError(error.code, error.message)
  }

  const codeFromError =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined

  if (typeof codeFromError === "string" && codeFromError.trim()) {
    return new CheckoutPaymentError(
      codeFromError,
      error instanceof Error ? error.message : "Promotion validation failed."
    )
  }

  const message =
    error instanceof Error ? error.message : "Promotion validation failed."

  if (/usage exceeds|budget limit|promotion limit exceeded/i.test(message)) {
    return new CheckoutPaymentError("COUPON_USAGE_LIMIT_REACHED", message)
  }

  if (/expired|has expired/i.test(message)) {
    return new CheckoutPaymentError("COUPON_EXPIRED", message)
  }

  if (/not started|hasn't started|not yet active/i.test(message)) {
    return new CheckoutPaymentError("COUPON_NOT_STARTED", message)
  }

  if (/minimum|min cart|min subtotal|min spend|min order/i.test(message)) {
    return new CheckoutPaymentError("COUPON_MIN_CART_NOT_MET", message)
  }

  return new CheckoutPaymentError("COUPON_INVALID", message)
}

async function assertCouponUsageLimits(
  scope: ScopeLike,
  promoCodes: string[]
): Promise<void> {
  if (!promoCodes.length) {
    return
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "promotion",
    fields: [
      "id",
      "code",
      "limit",
      "used",
      "campaign.budget.id",
      "campaign.budget.type",
      "campaign.budget.limit",
      "campaign.budget.used",
    ],
    filters: { code: promoCodes },
  })

  const promotions = Array.isArray(data) ? data : []

  for (const promoCode of promoCodes) {
    const promotion = promotions.find(
      (entry: { code?: string }) => normalizeCode(entry.code) === promoCode
    )

    if (!promotion) {
      continue
    }

    const limit = toNumber((promotion as { limit?: unknown }).limit)
    const used = toNumber((promotion as { used?: unknown }).used)
    if (limit > 0 && used >= limit) {
      throw new CheckoutPaymentError(
        "COUPON_USAGE_LIMIT_REACHED",
        `Coupon ${promoCode} usage limit has been reached.`
      )
    }

    const budget = (promotion as {
      campaign?: {
        budget?: {
          limit?: unknown
          used?: unknown
        } | null
      } | null
    }).campaign?.budget

    const budgetLimit = toNumber(budget?.limit)
    const budgetUsed = toNumber(budget?.used)
    if (budgetLimit > 0 && budgetUsed >= budgetLimit) {
      throw new CheckoutPaymentError(
        "COUPON_USAGE_LIMIT_REACHED",
        `Coupon ${promoCode} usage limit has been reached.`
      )
    }
  }
}

async function revalidateCartPromotionsForOrderPlacement(
  scope: ScopeLike,
  cart: CartLike
): Promise<CartLike> {
  const manualPromoCodes = getManualPromoCodes(cart)
  if (manualPromoCodes.length > 0) {
    ensureCouponStackingAllowed(cart, manualPromoCodes[0])
  }

  await assertCouponUsageLimits(scope, manualPromoCodes)

  if (!manualPromoCodes.length) {
    return cart
  }

  const workflowEngine = scope.resolve(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(updateCartPromotionsWorkflowId, {
    input: {
      cart_id: cart.id,
      promo_codes: manualPromoCodes,
      action: PromotionActions.REPLACE,
      force_refresh_payment_collection: true,
    },
  })

  const refreshedCart = await getCart(scope, cart.id)
  const refreshedManualPromoCodes = getManualPromoCodes(refreshedCart)
  const missingCodes = manualPromoCodes.filter(
    (code) => !refreshedManualPromoCodes.includes(code)
  )

  if (missingCodes.length) {
    throw new CheckoutPaymentError(
      "COUPON_INVALID",
      `Coupon ${missingCodes[0]} is no longer valid for this cart.`
    )
  }

  return refreshedCart
}

async function getCart(scope: ScopeLike, cartId: string): Promise<CartLike> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "grand_total",
      "total",
      "subtotal",
      "discount_total",
      "shipping_total",
      "original_shipping_total",
      "shipping_discount_total",
      "payment_collection.id",
      "payment_collection.amount",
      "payment_collection.currency_code",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.status",
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
      "shipping_methods.shipping_option_id",
      "shipping_methods.shipping_option.id",
      "shipping_methods.shipping_option.name",
      "shipping_methods.shipping_option.code",
      "shipping_methods.shipping_option.type.code",
      "shipping_methods.shipping_option.type.label",
      "shipping_methods.shipping_option.metadata",
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
    throw new CheckoutPaymentError(
      "CART_NOT_FOUND",
      `Cart ${cartId} not found for checkout.`
    )
  }

  return cart
}

async function getShippingOptionById(scope: ScopeLike, optionId: string) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "code", "type.code", "type.label", "metadata"],
    filters: { id: optionId },
  })

  return first(data)
}

async function isCodCheckout(scope: ScopeLike, cart: CartLike): Promise<boolean> {
  const shippingMethods = Array.isArray(cart.shipping_methods)
    ? cart.shipping_methods
    : []

  for (const method of shippingMethods) {
    if (method.shipping_option && isCodOption(method.shipping_option)) {
      return true
    }
  }

  const missingOptionIds = shippingMethods
    .filter(
      (method) =>
        !method.shipping_option && typeof method.shipping_option_id === "string"
    )
    .map((method) => method.shipping_option_id as string)

  for (const optionId of missingOptionIds) {
    const option = await getShippingOptionById(scope, optionId)
    if (option && isCodOption(option as any)) {
      return true
    }
  }

  return false
}

function getCodSession(cart: CartLike) {
  const paymentSessions = Array.isArray(cart.payment_collection?.payment_sessions)
    ? cart.payment_collection?.payment_sessions
    : []

  return paymentSessions.find(
    (session) => session.provider_id === COD_PAYMENT_PROVIDER_ID
  )
}

export async function paymentInitWorkflow(scope: ScopeLike, params: {
  cart_id: string
  customer_id?: string
  shipping_option_id?: string
  correlation_id?: string
}): Promise<PaymentInitResult> {
  setCorrelationContext({
    correlation_id: params.correlation_id,
    workflow_name: "checkout_cod_payment_init",
    cart_id: params.cart_id,
  })
  logStructured(scope as any, "info", "Initializing COD payment session", {
    workflow_name: "checkout_cod_payment_init",
    step_name: "start",
    cart_id: params.cart_id,
  })

  const cart = await getCart(scope, params.cart_id)
  let codCheckout = false

  if (typeof params.shipping_option_id === "string" && params.shipping_option_id) {
    const selectedOption = await getShippingOptionById(
      scope,
      params.shipping_option_id
    )
    codCheckout = !!selectedOption && isCodOption(selectedOption as any)
  } else {
    codCheckout = await isCodCheckout(scope, cart)
  }

  if (!codCheckout) {
    return { skipped: true, reason: "not_cod" }
  }

  const paymentCollection = cart.payment_collection
  if (!paymentCollection?.id) {
    throw new CheckoutPaymentError(
      "PAYMENT_INIT_FAILED",
      "Cart has no payment collection for COD initialization."
    )
  }

  const existingCodSession = getCodSession(cart)
  if (existingCodSession?.id) {
    return {
      skipped: false,
      payment_session_id: existingCodSession.id,
    }
  }

  const paymentModule = scope.resolve(Modules.PAYMENT)
  const existingSessions = Array.isArray(paymentCollection.payment_sessions)
    ? paymentCollection.payment_sessions
    : []

  for (const session of existingSessions) {
    if (session.id) {
      await paymentModule.deletePaymentSession(session.id)
    }
  }

  await paymentModule.createPaymentSession(paymentCollection.id, {
    provider_id: COD_PAYMENT_PROVIDER_ID,
    currency_code: paymentCollection.currency_code || "INR",
    amount: paymentCollection.amount || 0,
    data: {
      cart_id: params.cart_id,
      payment_method: "cod",
    },
  })

  const refreshedCart = await getCart(scope, params.cart_id)
  const createdCodSession = getCodSession(refreshedCart)

  if (!createdCodSession?.id) {
    throw new CheckoutPaymentError(
      "PAYMENT_INIT_FAILED",
      "Failed to initialize COD payment session."
    )
  }

  return {
    skipped: false,
    payment_session_id: createdCodSession.id,
  }
}

export async function paymentAuthorizeWorkflow(scope: ScopeLike, params: {
  cart_id: string
  correlation_id?: string
}): Promise<PaymentAuthorizeResult> {
  setCorrelationContext({
    correlation_id: params.correlation_id,
    workflow_name: "checkout_cod_payment_authorize",
    cart_id: params.cart_id,
  })
  logStructured(scope as any, "info", "Authorizing COD payment session", {
    workflow_name: "checkout_cod_payment_authorize",
    step_name: "start",
    cart_id: params.cart_id,
  })

  const cart = await getCart(scope, params.cart_id)
  const codCheckout = await isCodCheckout(scope, cart)

  if (!codCheckout) {
    return { skipped: true, reason: "not_cod" }
  }

  const codSession = getCodSession(cart)
  if (!codSession?.id) {
    throw new CheckoutPaymentError(
      "PAYMENT_SESSION_NOT_FOUND",
      "COD payment session is missing for authorization."
    )
  }

  if (isAuthorizedStatus(codSession.status)) {
    return {
      skipped: false,
      payment_session_id: codSession.id,
      already_authorized: true,
    }
  }

  const paymentModule = scope.resolve(Modules.PAYMENT)
  await paymentModule.authorizePaymentSession(codSession.id, {})

  const refreshedCart = await getCart(scope, params.cart_id)
  const refreshedCodSession = getCodSession(refreshedCart)

  if (!refreshedCodSession?.id || !isAuthorizedStatus(refreshedCodSession.status)) {
    throw new CheckoutPaymentError(
      "PAYMENT_NOT_AUTHORIZED",
      "COD payment authorization failed before order placement."
    )
  }

  await emitBusinessEvent(scope as any, {
    name: "payment.authorized",
    correlation_id: params.correlation_id,
    workflow_name: "checkout_cod_payment_authorize",
    step_name: "emit_event",
    cart_id: params.cart_id,
    data: {
      cart_id: params.cart_id,
      payment_provider_id: COD_PAYMENT_PROVIDER_ID,
      payment_method: "cod",
      payment_session_id: refreshedCodSession.id,
    },
  })
  await emitBusinessEvent(scope as any, {
    name: "cod.authorized",
    correlation_id: params.correlation_id,
    workflow_name: "checkout_cod_payment_authorize",
    step_name: "emit_event",
    cart_id: params.cart_id,
    data: {
      cart_id: params.cart_id,
      payment_session_id: refreshedCodSession.id,
    },
  })

  return {
    skipped: false,
    payment_session_id: refreshedCodSession.id,
    already_authorized: false,
  }
}

export async function orderPlaceWorkflow(scope: ScopeLike, params: {
  cart_id: string
  correlation_id?: string
}): Promise<void> {
  const startedAt = nowMs()
  let outcome: "success" | "failure" = "failure"
  let failureCode: string | undefined

  setCorrelationContext({
    correlation_id: params.correlation_id,
    workflow_name: "checkout_order_place_guard",
    cart_id: params.cart_id,
  })
  logStructured(scope as any, "info", "Running order placement guard", {
    workflow_name: "checkout_order_place_guard",
    step_name: "start",
    cart_id: params.cart_id,
  })

  try {
    let cart = await getCart(scope, params.cart_id)
    try {
      cart = await revalidateCartPromotionsForOrderPlacement(scope, cart)
    } catch (error) {
      throw mapPromotionError(error)
    }

    try {
      enforcePriceIntegrity(cart)
    } catch (error) {
      if (error instanceof PriceIntegrityError) {
        throw new CheckoutPaymentError(error.code, error.message)
      }
      throw error
    }

    const codCheckout = await isCodCheckout(scope, cart)

    if (!codCheckout) {
      outcome = "success"
      return
    }

    const codSession = getCodSession(cart)
    if (!codSession?.id || !isAuthorizedStatus(codSession.status)) {
      throw new CheckoutPaymentError(
        "PAYMENT_NOT_AUTHORIZED",
        "Order placement requires COD payment authorization."
      )
    }

    outcome = "success"
  } catch (error) {
    failureCode = extractErrorCode(error)
    throw error
  } finally {
    const labels = {
      workflow: "order_place",
      result: outcome,
      ...(failureCode ? { error_code: failureCode } : {}),
    }
    observeDuration(
      "workflow.order_place.duration_ms",
      nowMs() - startedAt,
      labels
    )
    increment(
      `workflow.order_place.${outcome}_total`,
      labels
    )
  }
}
