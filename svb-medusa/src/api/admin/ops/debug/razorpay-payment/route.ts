import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  toApiErrorResponse,
  validationError,
} from "../../../../../modules/observability/errors"

type QueryGraphLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return readText(value[0])
  }

  return readText(value)
}

function first<T>(value: T[] | null | undefined): T | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  return value[0]
}

function getActorId(req: MedusaRequest): string | null {
  const actorId = readText((req as any)?.auth_context?.actor_id)
  return actorId || null
}

function pickRazorpaySessionMetadata(session: {
  id?: unknown
  provider_id?: unknown
  status?: unknown
  data?: unknown
}): Record<string, unknown> | null {
  const providerId = readText(session.provider_id)
  const data =
    session.data && typeof session.data === "object"
      ? (session.data as Record<string, unknown>)
      : {}

  const hasRazorpayMarkers =
    providerId.toLowerCase().includes("razorpay") ||
    Boolean(
      readText(data.razorpay_order_id) ||
        readText(data.razorpay_payment_id) ||
        readText(data.razorpay_payment_status)
    )

  if (!hasRazorpayMarkers) {
    return null
  }

  return {
    id: readText(session.id),
    provider_id: providerId || null,
    status: readText(session.status).toLowerCase() || null,
    metadata: {
      session_id: readText(data.session_id) || null,
      cart_id: readText(data.cart_id) || null,
      order_id: readText(data.order_id) || null,
      razorpay_order_id: readText(data.razorpay_order_id) || null,
      razorpay_payment_id: readText(data.razorpay_payment_id) || null,
      razorpay_payment_status: readText(data.razorpay_payment_status) || null,
      verified_at: readText(data.verified_at) || null,
      authorized_at: readText(data.authorized_at) || null,
      captured_at: readText(data.captured_at) || null,
      canceled_at: readText(data.canceled_at) || null,
      correlation_id: readText(data.correlation_id) || null,
    },
  }
}

async function resolveCartIdFromOrder(
  scope: unknown,
  orderId: string
): Promise<string | null> {
  const query = (scope as { resolve?: (key: string) => unknown }).resolve?.(
    ContainerRegistrationKeys.QUERY
  ) as QueryGraphLike
  const result = await query.graph({
    entity: "order",
    fields: ["id", "cart_id"],
    filters: {
      id: orderId,
    },
  })
  const order = first(
    (Array.isArray(result?.data) ? result.data : []) as Array<Record<string, unknown>>
  )

  return order ? readText(order.cart_id) || null : null
}

async function getCartPaymentSessions(
  scope: unknown,
  cartId: string
): Promise<{
  id: string
  payment_collection_id: string | null
  sessions: Array<Record<string, unknown>>
} | null> {
  const query = (scope as { resolve?: (key: string) => unknown }).resolve?.(
    ContainerRegistrationKeys.QUERY
  ) as QueryGraphLike
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
  const cart = first(
    (Array.isArray(result?.data) ? result.data : []) as Array<Record<string, unknown>>
  )
  if (!cart) {
    return null
  }

  const paymentCollection =
    cart.payment_collection && typeof cart.payment_collection === "object"
      ? (cart.payment_collection as Record<string, unknown>)
      : null
  const sessions = Array.isArray(paymentCollection?.payment_sessions)
    ? (paymentCollection?.payment_sessions as Array<Record<string, unknown>>)
    : []

  return {
    id: readText(cart.id),
    payment_collection_id: readText(paymentCollection?.id) || null,
    sessions,
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const actorId = getActorId(req)
  if (!actorId) {
    const mapped = toApiErrorResponse(
      validationError("UNAUTHORIZED", "Admin authentication is required.", {
        httpStatus: 401,
      })
    )
    res.status(mapped.status).json(mapped.body)
    return
  }

  try {
    const query = (req.query ?? {}) as Record<string, unknown>
    const orderId = readQueryString(query.order_id)
    let cartId = readQueryString(query.cart_id)

    if (!cartId && !orderId) {
      const mapped = toApiErrorResponse(
        validationError(
          "LOOKUP_ID_REQUIRED",
          "Either cart_id or order_id query param is required.",
          { httpStatus: 400 }
        )
      )
      res.status(mapped.status).json(mapped.body)
      return
    }

    if (!cartId && orderId) {
      cartId = (await resolveCartIdFromOrder(req.scope, orderId)) || ""
      if (!cartId) {
        const mapped = toApiErrorResponse(
          validationError("ORDER_NOT_FOUND", `Order ${orderId} was not found.`, {
            httpStatus: 404,
          })
        )
        res.status(mapped.status).json(mapped.body)
        return
      }
    }

    const cart = await getCartPaymentSessions(req.scope, cartId)
    if (!cart) {
      const mapped = toApiErrorResponse(
        validationError("CART_NOT_FOUND", `Cart ${cartId} was not found.`, {
          httpStatus: 404,
        })
      )
      res.status(mapped.status).json(mapped.body)
      return
    }

    const razorpaySessions = cart.sessions
      .map((session) => pickRazorpaySessionMetadata(session))
      .filter(Boolean) as Array<Record<string, unknown>>

    res.status(200).json({
      order_id: orderId || null,
      cart_id: cart.id,
      payment_collection_id: cart.payment_collection_id,
      razorpay_sessions: razorpaySessions,
      count: razorpaySessions.length,
    })
  } catch (error) {
    const mapped = toApiErrorResponse(error, {
      code: "RAZORPAY_DEBUG_LOOKUP_FAILED",
      message: "Failed to resolve Razorpay payment session metadata.",
      httpStatus: 500,
      category: "internal",
    })
    res.status(mapped.status).json(mapped.body)
  }
}
