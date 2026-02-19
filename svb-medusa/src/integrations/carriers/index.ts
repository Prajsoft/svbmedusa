import { FakeCarrierAdapter } from "./fake-carrier"
import type { CarrierAdapter } from "./types"

export class CarrierAdapterConfigError extends Error {
  code: string

  constructor(message: string) {
    super(message)
    this.name = "CarrierAdapterConfigError"
    this.code = "CARRIER_ADAPTER_CONFIG_ERROR"
  }
}

function resolveCarrierAdapterName(): string {
  const configured = process.env.CARRIER_ADAPTER?.trim().toLowerCase()
  if (configured) {
    return configured
  }

  if (process.env.NODE_ENV !== "production") {
    return "fake"
  }

  return ""
}

export function getCarrierAdapter(): CarrierAdapter {
  const adapter = resolveCarrierAdapterName()

  if (adapter === "fake") {
    return new FakeCarrierAdapter()
  }

  throw new CarrierAdapterConfigError(
    `Unsupported carrier adapter "${adapter || "unset"}".`
  )
}
