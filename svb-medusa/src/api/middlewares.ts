import { validateAndTransformQuery } from "@medusajs/framework"
import {
  authenticate,
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { z } from "zod"
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
import { logEvent } from "../modules/logging/log-event"
import { toAppError } from "../modules/observability/errors"

type VariantLike = {
  sku?: unknown
}

type ProductLike = {
  variants?: VariantLike[]
}

const productFeedQuerySchema = z.object({
  currency_code: z.string().min(1, "currency_code is required"),
  country_code: z.string().min(1, "country_code is required"),
  token: z.string().min(1, "token is required"),
})

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

function isProductFeedPath(req: MedusaRequest): boolean {
  const path =
    (typeof (req as any)?.path === "string" && (req as any).path) ||
    (typeof (req as any)?.originalUrl === "string" && (req as any).originalUrl) ||
    ""

  return path === "/product-feed" || path.startsWith("/product-feed?")
}

function getProductFeedValidationMessage(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: Array<{ message?: unknown }> }).issues
    const firstIssue = Array.isArray(issues) ? issues[0] : undefined
    if (typeof firstIssue?.message === "string" && firstIssue.message.trim()) {
      return firstIssue.message.trim()
    }
  }

  if (error instanceof Error && typeof error.message === "string") {
    const message = error.message.replace(/^Invalid request:\s*/i, "").trim()
    if (message) {
      return message
    }
  }

  return "Invalid query parameters."
}

function formatPublicErrorMessage(message: string, correlationId: string): string {
  const trimmed = typeof message === "string" ? message.trim() : ""
  const base = trimmed || "An unexpected error occurred."
  const normalized = base.endsWith(".") ? base : `${base}.`

  if (/support\s*code\s*:/i.test(normalized)) {
    return normalized
  }

  return `${normalized} Support Code: ${correlationId}.`
}

function getRequestCorrelationId(req: MedusaRequest): string {
  const fromReq = normalizePath((req as any)?.correlation_id)
  if (fromReq) {
    return fromReq
  }

  const computed = extractCorrelationIdFromRequest(req as any)
  ;(req as any).correlation_id = computed
  return computed
}

function sendApiErrorEnvelope(
  req: MedusaRequest,
  res: MedusaResponse,
  error: unknown,
  fallback: {
    code?: string
    message?: string
    httpStatus?: number
    category?: "validation" | "integrity" | "transient_external" | "permanent_external" | "internal"
  } = {}
): void {
  const appError = toAppError(error, fallback)
  const correlationId = getRequestCorrelationId(req)
  const details = appError.details ?? {}
  const publicMessage = formatPublicErrorMessage(appError.message, correlationId)

  res.status(appError.httpStatus).json({
    code: appError.code,
    message: publicMessage,
    details,
    correlation_id: correlationId,
    error: {
      code: appError.code,
      message: appError.message,
      details,
      correlation_id: correlationId,
    },
  })
}

export function correlationResponseBodyMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  const correlationId = getRequestCorrelationId(req)
  const originalJson = (res as any).json

  if (typeof originalJson !== "function") {
    next()
    return
  }

  ;(res as any).json = (payload: unknown) => {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const body = payload as Record<string, unknown>
      if (!("correlation_id" in body)) {
        return originalJson.call(res, {
          ...body,
          correlation_id: correlationId,
        })
      }
    }

    return originalJson.call(res, payload)
  }

  next()
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

    logEvent(
      "http.request.received",
      {
        step_name: "http_request",
        cart_id: normalizeEntityId((req as any)?.params?.id),
        order_id: normalizeEntityId((req as any)?.params?.order_id),
        return_id: normalizeEntityId((req as any)?.params?.return_id),
        method: normalizeMethod((req as any)?.method),
        path: normalizePath((req as any)?.originalUrl ?? (req as any)?.url),
      },
      correlationId,
      {
        scopeOrLogger: (req as any).scope,
      }
    )

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
      sendApiErrorEnvelope(req, res, error)
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
      sendApiErrorEnvelope(req, res, error)
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
      sendApiErrorEnvelope(req, res, error)
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
      sendApiErrorEnvelope(req, res, error)
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
      sendApiErrorEnvelope(req, res, error)
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
  errorHandler: (error, req, res, _next) => {
    if (isProductFeedPath(req)) {
      const message = getProductFeedValidationMessage(error)
      sendApiErrorEnvelope(
        req,
        res,
        {
          code: "INVALID_QUERY",
          message,
          details: {},
        },
        {
          code: "INVALID_QUERY",
          message,
          httpStatus: 400,
          category: "validation",
        }
      )
      return
    }

    sendApiErrorEnvelope(req, res, error)
  },
  routes: [
    {
      matcher: /^\/(store|admin|hooks|webhooks|shipments)(\/|$)/,
      middlewares: [correlationIdMiddleware, correlationResponseBodyMiddleware],
    },
    {
      methods: ["GET"],
      matcher: "/shipments/:id/label",
      middlewares: [authenticate("user", ["bearer", "session"])],
    },
    {
      methods: ["POST"],
      matcher: "/webhooks/shipping/shiprocket",
      bodyParser: {
        preserveRawBody: true,
      },
    },
    {
      methods: ["GET"],
      matcher: "/product-feed",
      middlewares: [validateAndTransformQuery(productFeedQuerySchema, {})],
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
