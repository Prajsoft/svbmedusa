import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getShippingPersistenceRepository } from "../../../../modules/shipping/provider-router"

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function buildTrackingUrl(awb: string | null): string | null {
  const code = readText(awb)
  return code ? `https://shiprocket.co/tracking/${code}` : null
}

function toIso(value: Date | null): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }
  return null
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = readText(req.params?.order_id)

  if (!orderId) {
    res.status(400).json({
      code: "ORDER_ID_REQUIRED",
      message: "order_id is required.",
      error: { code: "ORDER_ID_REQUIRED", message: "order_id is required." },
    })
    return
  }

  try {
    const repository = getShippingPersistenceRepository(req.scope as any)
    const shipment = await repository.getActiveShipmentByOrderId(orderId)

    if (!shipment) {
      res.status(200).json({ shipment: null })
      return
    }

    res.status(200).json({
      shipment: {
        provider: shipment.provider,
        provider_awb: shipment.provider_awb,
        tracking_url: buildTrackingUrl(shipment.provider_awb),
        status: shipment.status,
        courier_code: shipment.courier_code,
        updated_at: toIso(shipment.updated_at),
      },
    })
  } catch {
    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Unable to retrieve shipment information.",
      error: {
        code: "INTERNAL_ERROR",
        message: "Unable to retrieve shipment information.",
      },
    })
  }
}
