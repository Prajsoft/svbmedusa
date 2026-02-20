import { z } from "zod"
import {
  type ProviderCapabilities,
  providerCapabilitiesSchema,
} from "./IPaymentProvider"

export const providerCapabilitiesMatrixSchema = z.record(providerCapabilitiesSchema)

export type ProviderCapabilitiesMatrix = z.infer<typeof providerCapabilitiesMatrixSchema>

export const PAYMENT_PROVIDER_CAPABILITIES = {
  razorpay: {
    supportsRefunds: true,
    supportsWebhooks: true,
    supportsManualCapture: true,
  },
  cod: {
    supportsRefunds: true,
    supportsWebhooks: false,
    supportsManualCapture: false,
  },
} as const satisfies Record<string, ProviderCapabilities>

export function getProviderCapabilities(
  provider: string
): ProviderCapabilities | null {
  const normalized = provider.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  return PAYMENT_PROVIDER_CAPABILITIES[normalized] ?? null
}

