import {
  CORRELATION_ID_HEADER,
  extractCorrelationIdFromRequest,
} from "../../../modules/logging/correlation"
import { logEvent } from "../../../modules/logging/log-event"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { POST as sharedPaymentsWebhookPOST } from "../payments/[provider]/route"

type RequestWithParams = MedusaRequest & {
  params?: Record<string, string | undefined>
  correlation_id?: string
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const routeRequest = req as RequestWithParams
  const correlationId = extractCorrelationIdFromRequest(req as any)
  routeRequest.correlation_id = correlationId

  if (typeof (res as any).setHeader === "function") {
    ;(res as any).setHeader(CORRELATION_ID_HEADER, correlationId)
    ;(res as any).setHeader("x-webhook-endpoint-deprecated", "true")
    ;(res as any).setHeader(
      "x-webhook-endpoint-canonical",
      "/webhooks/payments/razorpay"
    )
  }

  logEvent(
    "PAYMENT_WEBHOOK_ALIAS_DEPRECATED",
    {
      alias: "/webhooks/razorpay",
      canonical: "/webhooks/payments/razorpay",
    },
    correlationId,
    {
      level: "warn",
      scopeOrLogger: (req as any).scope,
    }
  )

  routeRequest.params = {
    ...(routeRequest.params ?? {}),
    provider: "razorpay",
  }

  return sharedPaymentsWebhookPOST(routeRequest, res)
}
