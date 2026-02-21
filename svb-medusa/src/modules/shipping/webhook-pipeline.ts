import {
  ProviderErrorCode,
  type ShipmentStatus,
  ShippingProviderError,
} from "../../integrations/carriers/provider-contract"
import type {
  ProcessShippingWebhookResult,
  ShippingPersistenceRepository,
} from "./shipment-persistence"

type VerifyWebhookSignature = (input: {
  provider: string
  headers: Record<string, string | string[] | undefined>
  raw_body: string
  body?: Record<string, unknown>
}) => boolean | Promise<boolean>

export type ProcessCarrierWebhookInput = {
  provider: string
  provider_event_id: string
  provider_shipment_id?: string | null
  provider_awb?: string | null
  internal_reference?: string | null
  provider_order_id?: string | null
  event_type: string
  status?: ShipmentStatus | null
  payload?: Record<string, unknown> | null
  headers?: Record<string, string | string[] | undefined>
  raw_body?: string
  correlation_id: string
  repository: Pick<ShippingPersistenceRepository, "processShippingWebhookEvent">
  verify_signature?: VerifyWebhookSignature
}

export async function processCarrierWebhook(
  input: ProcessCarrierWebhookInput
): Promise<ProcessShippingWebhookResult> {
  if (typeof input.verify_signature !== "function") {
    throw new ShippingProviderError({
      code: ProviderErrorCode.SIGNATURE_INVALID,
      message:
        "Shipping webhook signature verifier is required. Unsigned webhooks are rejected by default.",
      correlation_id: input.correlation_id,
      details: {
        provider: input.provider,
      },
    })
  }

  const verified = await input.verify_signature({
    provider: input.provider,
    headers: input.headers ?? {},
    raw_body: input.raw_body ?? "",
    body: input.payload ?? undefined,
  })

  if (!verified) {
    throw new ShippingProviderError({
      code: ProviderErrorCode.SIGNATURE_INVALID,
      message: "Invalid shipping webhook signature.",
      correlation_id: input.correlation_id,
      details: {
        provider: input.provider,
        provider_event_id: input.provider_event_id,
      },
    })
  }

  return input.repository.processShippingWebhookEvent({
    provider: input.provider,
    provider_event_id: input.provider_event_id,
    provider_shipment_id: input.provider_shipment_id,
    provider_awb: input.provider_awb,
    internal_reference: input.internal_reference,
    provider_order_id: input.provider_order_id,
    event_type: input.event_type,
    status: input.status ?? null,
    payload_sanitized: input.payload ?? null,
  })
}
