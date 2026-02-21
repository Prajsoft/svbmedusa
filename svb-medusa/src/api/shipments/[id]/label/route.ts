import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveCorrelationId } from "../../../../modules/logging/correlation"
import { setCorrelationContext } from "../../../../modules/logging/correlation"
import { logStructured } from "../../../../modules/logging/structured-logger"
import { ShipmentLabelError, resolveShipmentLabel } from "../../../../modules/shipping/shipment-label"
import { ShippingProviderError } from "../../../../integrations/carriers/provider-contract"

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function actorType(value: unknown): string {
  return readText(value).toLowerCase()
}

function resolveRouteErrorStatus(error: unknown): number {
  if (error instanceof ShipmentLabelError) {
    return error.httpStatus
  }

  if (error instanceof ShippingProviderError) {
    if (error.code === "SHIPMENT_NOT_FOUND") {
      return 404
    }
    if (error.code === "RATE_LIMITED") {
      return 429
    }
    if (error.code === "PROVIDER_UNAVAILABLE") {
      return 503
    }
    return 502
  }

  return 500
}

function resolveRouteErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = readText((error as { code?: unknown }).code)
    if (code) {
      return code
    }
  }

  return "INTERNAL_ERROR"
}

function resolveRouteErrorMessage(error: unknown): string {
  if (error instanceof Error && readText(error.message)) {
    return error.message
  }
  return "Unable to fetch shipment label."
}

function isAdminActor(req: MedusaRequest): boolean {
  const actorId = readText((req as any)?.auth_context?.actor_id)
  if (!actorId) {
    return false
  }

  const type = actorType((req as any)?.auth_context?.actor_type)
  if (!type) {
    return true
  }

  return type === "user" || type === "admin"
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const correlationId = resolveCorrelationId((req as any)?.correlation_id)
  setCorrelationContext({
    correlation_id: correlationId,
    workflow_name: "shipment_label_route",
    step_name: "start",
  })

  if (!isAdminActor(req)) {
    res.status(401).json({
      code: "UNAUTHORIZED",
      message: "Admin authentication is required.",
      correlation_id: correlationId,
      error: {
        code: "UNAUTHORIZED",
        message: "Admin authentication is required.",
      },
    })
    return
  }

  try {
    const shipmentId = readText(req.params?.id)
    const result = await resolveShipmentLabel(
      req.scope as any,
      {
        shipment_id: shipmentId,
        correlation_id: correlationId,
      }
    )

    res.status(200).json({
      ...result,
      correlation_id: correlationId,
    })
  } catch (error) {
    const status = resolveRouteErrorStatus(error)
    const code = resolveRouteErrorCode(error)
    const message = resolveRouteErrorMessage(error)

    logStructured(req.scope as any, "error", "shipment label route failed", {
      workflow_name: "shipment_label_route",
      step_name: "error",
      error_code: code,
      meta: {
        shipment_id: readText(req.params?.id),
        status,
      },
    })

    res.status(status).json({
      code,
      message,
      correlation_id: correlationId,
      error: {
        code,
        message,
      },
    })
  }
}

