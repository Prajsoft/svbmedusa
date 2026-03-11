import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  CORRELATION_ID_HEADER,
  extractCorrelationIdFromRequest,
} from "../../../../../../../modules/logging/correlation"
import {
  toAppError,
  validationError,
} from "../../../../../../../modules/observability/errors"

type QueryGraphLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

type PaymentModuleLike = {
  authorizePaymentSession: (
    id: string,
    context: Record<string, unknown>
  ) => Promise<unknown>
}

type RazorpaySessionRecord = Record<string, unknown>

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function getCorrelationId(req: MedusaRequest): string {
  const existing = readText((req as any)?.correlation_id)
  if (existing) {
    return existing
  }

  const resolved = extractCorrelationIdFromRequest(req as any)
  ;(req as any).correlation_id = resolved
  return resolved
}

function formatPublicErrorMessage(message: string, correlationId: string): string {
  const trimmed = readText(message) || "An unexpected error occurred."
  const normalized = trimmed.endsWith(".") ? trimmed : `${trimmed}.`

  if (/support\s*code\s*:/i.test(normalized)) {
    return normalized
  }

  return `${normalized} Support Code: ${correlationId}.`
}

function sendApiError(
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
  const correlationId = getCorrelationId(req)
  const details = appError.details ?? {}

  res.status(appError.httpStatus).json({
    code: appError.code,
    message: formatPublicErrorMessage(appError.message, correlationId),
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

function readSessionData(
  session: RazorpaySessionRecord
): Record<string, unknown> {
  return session.data && typeof session.data === "object"
    ? (session.data as Record<string, unknown>)
    : {}
}

function isRazorpaySession(session: RazorpaySessionRecord): boolean {
  const providerId = readText(session.provider_id).toLowerCase()
  if (providerId.includes("razorpay")) {
    return true
  }

  const data = readSessionData(session)
  return Boolean(
    readText(data.razorpay_order_id) ||
      readText(data.razorpay_payment_id) ||
      readText(data.razorpay_payment_status)
  )
}

function isCompletedSession(session: RazorpaySessionRecord): boolean {
  const data = readSessionData(session)
  const sessionStatus = readText(session.status).toLowerCase()
  const paymentStatus = readText(data.razorpay_payment_status).toLowerCase()

  return (
    sessionStatus === "authorized" ||
    sessionStatus === "captured" ||
    paymentStatus === "authorized" ||
    paymentStatus === "captured" ||
    Boolean(
      readText(data.verified_at) ||
        readText(data.authorized_at) ||
        readText(data.captured_at)
    )
  )
}

function matchesAuthorizationPayload(
  session: RazorpaySessionRecord,
  input: {
    orderId: string
    paymentId: string
    providerId?: string
  }
): boolean {
  if (!isRazorpaySession(session)) {
    return false
  }

  const providerId = readText(session.provider_id)
  if (input.providerId && providerId && providerId !== input.providerId) {
    return false
  }

  const data = readSessionData(session)
  const storedOrderId = readText(data.razorpay_order_id)
  const storedPaymentId = readText(data.razorpay_payment_id)

  return (
    (Boolean(input.orderId) && storedOrderId === input.orderId) ||
    (Boolean(input.paymentId) && storedPaymentId === input.paymentId)
  )
}

function pickAuthorizationTargetSession(
  sessions: RazorpaySessionRecord[],
  input: {
    orderId: string
    paymentId: string
    providerId?: string
  }
): RazorpaySessionRecord | null {
  const razorpaySessions = sessions.filter(isRazorpaySession)
  if (!razorpaySessions.length) {
    return null
  }

  const exactMatch = razorpaySessions.find((session) =>
    matchesAuthorizationPayload(session, input)
  )
  if (exactMatch) {
    return exactMatch
  }

  const pendingMatch = razorpaySessions.find(
    (session) => readText(session.status).toLowerCase() === "pending"
  )
  if (pendingMatch) {
    return pendingMatch
  }

  return razorpaySessions[0] ?? null
}

function serializePaymentSession(session: RazorpaySessionRecord | null) {
  if (!session) {
    return null
  }

  const data = readSessionData(session)

  return {
    id: readText(session.id),
    provider_id: readText(session.provider_id) || null,
    status: readText(session.status).toLowerCase() || null,
    data: {
      correlation_id: readText(data.correlation_id) || null,
      razorpay_order_id: readText(data.razorpay_order_id) || null,
      razorpay_payment_id: readText(data.razorpay_payment_id) || null,
      razorpay_payment_status: readText(data.razorpay_payment_status) || null,
      verified_at: readText(data.verified_at) || null,
      authorized_at: readText(data.authorized_at) || null,
      captured_at: readText(data.captured_at) || null,
    },
  }
}

async function getCartPaymentSessions(
  scope: unknown,
  cartId: string
): Promise<{
  id: string
  payment_collection_id: string | null
  sessions: RazorpaySessionRecord[]
} | null> {
  const query = (scope as { resolve?: (key: string) => unknown }).resolve?.(
    ContainerRegistrationKeys.QUERY
  ) as QueryGraphLike | undefined

  if (!query) {
    return null
  }

  const result = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "payment_collection.id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.data",
    ],
    filters: {
      id: cartId,
    },
  })

  const cart = Array.isArray(result?.data)
    ? ((result.data[0] as Record<string, unknown> | undefined) ?? null)
    : null

  if (!cart) {
    return null
  }

  const paymentCollection =
    cart.payment_collection && typeof cart.payment_collection === "object"
      ? (cart.payment_collection as Record<string, unknown>)
      : null

  return {
    id: readText(cart.id),
    payment_collection_id: readText(paymentCollection?.id) || null,
    sessions: Array.isArray(paymentCollection?.payment_sessions)
      ? (paymentCollection?.payment_sessions as RazorpaySessionRecord[])
      : [],
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const correlationId = getCorrelationId(req)
  if (typeof (res as any).setHeader === "function") {
    ;(res as any).setHeader(CORRELATION_ID_HEADER, correlationId)
  }

  try {
    const cartId = readText(req.params?.id)
    if (!cartId) {
      throw validationError("CART_ID_REQUIRED", "Cart id is required.")
    }

    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {}
    const providerId = readText(body.provider_id)
    const orderId = readText(body.razorpay_order_id)
    const paymentId = readText(body.razorpay_payment_id)
    const signature = readText(body.razorpay_signature)

    if (providerId && !providerId.toLowerCase().includes("razorpay")) {
      throw validationError(
        "PAYMENT_PROVIDER_INVALID",
        "This route only supports Razorpay payment authorization."
      )
    }

    const missingFields = [
      orderId ? null : "razorpay_order_id",
      paymentId ? null : "razorpay_payment_id",
      signature ? null : "razorpay_signature",
    ].filter(Boolean) as string[]

    if (missingFields.length) {
      throw validationError(
        "VALIDATION_ERROR",
        "Missing required Razorpay authorization fields.",
        {
          details: {
            missing_fields: missingFields,
          },
        }
      )
    }

    const cart = await getCartPaymentSessions(req.scope, cartId)
    if (!cart) {
      throw validationError("CART_NOT_FOUND", `Cart ${cartId} was not found.`, {
        httpStatus: 404,
      })
    }

    if (!cart.payment_collection_id) {
      throw validationError(
        "PAYMENT_COLLECTION_NOT_FOUND",
        "No payment collection found for this cart.",
        {
          httpStatus: 404,
        }
      )
    }

    const targetSession = pickAuthorizationTargetSession(cart.sessions, {
      orderId,
      paymentId,
      providerId,
    })

    if (!targetSession) {
      throw validationError(
        "PAYMENT_SESSION_NOT_FOUND",
        "No Razorpay payment session found for this cart.",
        {
          httpStatus: 404,
        }
      )
    }

    const targetSessionId = readText(targetSession.id)
    if (!targetSessionId) {
      throw validationError(
        "PAYMENT_SESSION_NOT_FOUND",
        "No valid Razorpay payment session found for this cart.",
        {
          httpStatus: 404,
        }
      )
    }

    if (
      matchesAuthorizationPayload(targetSession, {
        orderId,
        paymentId,
        providerId,
      }) &&
      isCompletedSession(targetSession)
    ) {
      res.status(200).json({
        ok: true,
        authorized: true,
        correlation_id: correlationId,
        payment_session: serializePaymentSession(targetSession),
      })
      return
    }

    const paymentModule = req.scope.resolve(Modules.PAYMENT) as PaymentModuleLike
    await paymentModule.authorizePaymentSession(targetSessionId, {
      provider_id: providerId || readText(targetSession.provider_id),
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      internal_reference: readText(body.internal_reference) || cartId,
      cart_id: cartId,
      correlation_id: correlationId,
    })

    const refreshedCart = await getCartPaymentSessions(req.scope, cartId)
    const refreshedSession = pickAuthorizationTargetSession(
      refreshedCart?.sessions ?? [],
      {
        orderId,
        paymentId,
        providerId,
      }
    )

    res.status(200).json({
      ok: true,
      authorized: true,
      correlation_id: correlationId,
      payment_session: serializePaymentSession(refreshedSession ?? targetSession),
    })
  } catch (error) {
    sendApiError(req, res, error, {
      code: "RAZORPAY_AUTHORIZE_FAILED",
      message: "Failed to authorize Razorpay payment session.",
      httpStatus: 500,
      category: "internal",
    })
  }
}
