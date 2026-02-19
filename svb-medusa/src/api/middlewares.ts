import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import {
  assertValidSku,
} from "../modules/catalog/validate-sku"
import {
  validateCartLogistics,
} from "../modules/catalog/validate-logistics"
import {
  validateSelectedShippingOptionForCart,
} from "../modules/shipping/eligibility"
import {
  checkAvailabilityForAddToCart,
  checkAvailabilityForCompleteCart,
  checkAvailabilityForUpdateCartLineItem,
} from "../modules/inventory/check-availability"
import {
  orderPlaceWorkflow,
  paymentAuthorizeWorkflow,
  paymentInitWorkflow,
} from "../workflows/checkout/cod-checkout"
import {
  CORRELATION_ID_HEADER,
  extractCorrelationIdFromRequest,
  runWithCorrelationContext,
  setCorrelationContext,
} from "../modules/logging/correlation"
import { logStructured } from "../modules/logging/structured-logger"
import { toApiErrorResponse } from "../modules/observability/errors"

type VariantLike = {
  sku?: unknown
}

type ProductLike = {
  variants?: VariantLike[]
}

function normalizeMethod(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim().toUpperCase()
  return normalized || undefined
}

function normalizePath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeEntityId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

export function correlationIdMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  const correlationId = extractCorrelationIdFromRequest(req as any)
  ;(req as any).correlation_id = correlationId

  if (typeof (res as any).setHeader === "function") {
    ;(res as any).setHeader(CORRELATION_ID_HEADER, correlationId)
  }

  runWithCorrelationContext(correlationId, () => {
    setCorrelationContext({
      correlation_id: correlationId,
      step_name: "http_request",
      cart_id: normalizeEntityId((req as any)?.params?.id),
      order_id: normalizeEntityId((req as any)?.params?.order_id),
      return_id: normalizeEntityId((req as any)?.params?.return_id),
    })

    logStructured((req as any).scope, "info", "HTTP request received", {
      correlation_id: correlationId,
      step_name: "http_request",
      cart_id: normalizeEntityId((req as any)?.params?.id),
      order_id: normalizeEntityId((req as any)?.params?.order_id),
      return_id: normalizeEntityId((req as any)?.params?.return_id),
      meta: {
        method: normalizeMethod((req as any)?.method),
        path: normalizePath((req as any)?.originalUrl ?? (req as any)?.url),
      },
    })

    next()
  })
}

export function validateVariantCreateBody(body: VariantLike): void {
  const sku = typeof body?.sku === "string" ? body.sku : ""
  assertValidSku(sku)
}

export function validateVariantUpdateBody(body: VariantLike): void {
  if (body?.sku === undefined) {
    return
  }

  const sku = typeof body.sku === "string" ? body.sku : ""
  assertValidSku(sku)
}

export function validateProductCreateBody(body: ProductLike): void {
  const variants = Array.isArray(body?.variants) ? body.variants : []

  for (const variant of variants) {
    validateVariantCreateBody(variant)
  }
}

export function validateProductUpdateBody(body: ProductLike): void {
  const variants = Array.isArray(body?.variants) ? body.variants : []

  for (const variant of variants) {
    validateVariantUpdateBody(variant)
  }
}

function makeSkuValidationMiddleware(
  validator: (body: Record<string, unknown>) => void
) {
  return (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): void => {
    try {
      validator((req.body as Record<string, unknown>) ?? {})
      next()
    } catch (error) {
      const mapped = toApiErrorResponse(error)
      res.status(mapped.status).json(mapped.body)
    }
  }
}

export function makeInventoryValidationMiddleware(
  validator: (req: MedusaRequest) => Promise<void>
) {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    try {
      await validator(req)
      next()
    } catch (error) {
      const mapped = toApiErrorResponse(error)
      res.status(mapped.status).json(mapped.body)
    }
  }
}

export function makeLogisticsValidationMiddleware(
  validator: (req: MedusaRequest) => Promise<void>
) {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    try {
      await validator(req)
      next()
    } catch (error) {
      const mapped = toApiErrorResponse(error)
      res.status(mapped.status).json(mapped.body)
    }
  }
}

export function makeShippingOptionEligibilityMiddleware(
  validator: (req: MedusaRequest) => Promise<void>
) {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    try {
      await validator(req)
      next()
    } catch (error) {
      const mapped = toApiErrorResponse(error)
      res.status(mapped.status).json(mapped.body)
    }
  }
}

export function makeCheckoutPaymentWorkflowMiddleware(
  validator: (req: MedusaRequest) => Promise<void>
) {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    try {
      await validator(req)
      next()
    } catch (error) {
      const mapped = toApiErrorResponse(error)
      res.status(mapped.status).json(mapped.body)
    }
  }
}

export async function validateStoreAddToCartBody(req: MedusaRequest): Promise<void> {
  const body = (req.body as Record<string, unknown>) ?? {}
  const variantId = typeof body.variant_id === "string" ? body.variant_id : ""
  const quantity = Number(body.quantity ?? 0)

  if (!variantId || !Number.isFinite(quantity) || quantity <= 0) {
    return
  }

  await checkAvailabilityForAddToCart(req.scope as any, req.params.id, variantId, quantity)
}

export async function validateStoreUpdateLineItemBody(
  req: MedusaRequest
): Promise<void> {
  const body = (req.body as Record<string, unknown>) ?? {}

  if (body.quantity === undefined) {
    return
  }

  const nextQuantity = Number(body.quantity)
  if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
    return
  }

  await checkAvailabilityForUpdateCartLineItem(
    req.scope as any,
    req.params.id,
    req.params.line_id,
    nextQuantity
  )
}

export async function validateStoreCompleteCartBody(
  req: MedusaRequest
): Promise<void> {
  await checkAvailabilityForCompleteCart(req.scope as any, req.params.id)
}

export async function validateStoreSelectShippingMethodBody(
  req: MedusaRequest
): Promise<void> {
  await validateCartLogistics(req.scope as any, req.params.id)
}

export async function validateStoreSelectShippingOptionEligibilityBody(
  req: MedusaRequest
): Promise<void> {
  const body = (req.body as Record<string, unknown>) ?? {}
  const optionId = typeof body.option_id === "string" ? body.option_id : ""

  if (!optionId) {
    return
  }

  await validateSelectedShippingOptionForCart(req.scope as any, req.params.id, optionId)
}

export async function validateStoreCodPaymentInitWorkflow(
  req: MedusaRequest
): Promise<void> {
  const body = (req.body as Record<string, unknown>) ?? {}
  const shippingOptionId =
    typeof body.option_id === "string" ? body.option_id : undefined
  const correlationId = (req as any).correlation_id as string | undefined

  await paymentInitWorkflow(req.scope as any, {
    cart_id: req.params.id,
    customer_id: (req as any)?.auth_context?.actor_id,
    shipping_option_id: shippingOptionId,
    correlation_id: correlationId,
  })
}

export async function validateStoreCodPaymentAuthorizeWorkflow(
  req: MedusaRequest
): Promise<void> {
  const correlationId = (req as any).correlation_id as string | undefined

  await paymentInitWorkflow(req.scope as any, {
    cart_id: req.params.id,
    customer_id: (req as any)?.auth_context?.actor_id,
    correlation_id: correlationId,
  })
  await paymentAuthorizeWorkflow(req.scope as any, {
    cart_id: req.params.id,
    correlation_id: correlationId,
  })
  await orderPlaceWorkflow(req.scope as any, {
    cart_id: req.params.id,
    correlation_id: correlationId,
  })
}

export default defineMiddlewares({
  routes: [
    {
      matcher: /^\/(store|admin)(\/|$)/,
      middlewares: [correlationIdMiddleware],
    },
    {
      methods: ["POST"],
      matcher: "/admin/products",
      middlewares: [makeSkuValidationMiddleware(validateProductCreateBody)],
    },
    {
      methods: ["POST"],
      matcher: "/admin/products/:id",
      middlewares: [makeSkuValidationMiddleware(validateProductUpdateBody)],
    },
    {
      methods: ["POST"],
      matcher: "/admin/products/:id/variants",
      middlewares: [makeSkuValidationMiddleware(validateVariantCreateBody)],
    },
    {
      methods: ["POST"],
      matcher: "/admin/products/:id/variants/:variant_id",
      middlewares: [makeSkuValidationMiddleware(validateVariantUpdateBody)],
    },
    {
      methods: ["POST"],
      matcher: "/store/carts/:id/line-items",
      middlewares: [makeInventoryValidationMiddleware(validateStoreAddToCartBody)],
    },
    {
      methods: ["POST"],
      matcher: "/store/carts/:id/line-items/:line_id",
      middlewares: [
        makeInventoryValidationMiddleware(validateStoreUpdateLineItemBody),
      ],
    },
    {
      methods: ["POST"],
      matcher: "/store/carts/:id/complete",
      middlewares: [
        makeCheckoutPaymentWorkflowMiddleware(validateStoreCodPaymentAuthorizeWorkflow),
        makeLogisticsValidationMiddleware(validateStoreSelectShippingMethodBody),
        makeInventoryValidationMiddleware(validateStoreCompleteCartBody),
      ],
    },
    {
      methods: ["POST"],
      matcher: "/store/carts/:id/shipping-methods",
      middlewares: [
        makeLogisticsValidationMiddleware(validateStoreSelectShippingMethodBody),
        makeShippingOptionEligibilityMiddleware(
          validateStoreSelectShippingOptionEligibilityBody
        ),
        makeCheckoutPaymentWorkflowMiddleware(validateStoreCodPaymentInitWorkflow),
      ],
    },
  ],
})
