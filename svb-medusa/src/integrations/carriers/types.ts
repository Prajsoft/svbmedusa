import type { ShipmentContract } from "../../modules/shipping/build-shipment-contract"

export type CarrierTrackingStatus =
  | "requested"
  | "ready_for_shipment"
  | "shipped"
  | "delivered"
  | "delivery_failed"
  | "rto_initiated"
  | "rto_delivered"
  | "unknown"

export type CarrierTrackingEvent = {
  status: CarrierTrackingStatus
  timestamp: string
  location?: string
  note?: string
  raw_status?: string
}

export type CreateShipmentResult = {
  carrier_shipment_id: string
  label_url?: string
  tracking_number?: string
}

export type CancelShipmentResult = {
  cancelled: boolean
}

export type GetTrackingResult = {
  status: CarrierTrackingStatus
  history: CarrierTrackingEvent[]
}

export interface CarrierAdapter {
  createShipment(shipmentContract: ShipmentContract): Promise<CreateShipmentResult>
  cancelShipment(carrier_shipment_id: string): Promise<CancelShipmentResult>
  getTracking(input: {
    carrier_shipment_id?: string
    tracking_number?: string
  }): Promise<GetTrackingResult>
  verifyWebhook?(request: {
    headers: Record<string, string | string[] | undefined>
    raw_body: string
    body?: unknown
  }): boolean
}
