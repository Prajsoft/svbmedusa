import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import type {
  CalculateShippingOptionPriceDTO,
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  CreateShippingOptionDTO,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
} from "@medusajs/framework/types"
import { ShiprocketProvider } from "../../integrations/carriers/shiprocket"
import {
  buildShipmentContract,
  ShipmentContractBuildError,
} from "../shipping/build-shipment-contract"
import { LogisticsValidationError } from "../catalog/validate-logistics"

// ── Shipping options shown in the Medusa admin ──────────────────────────────

const FULFILLMENT_OPTIONS: FulfillmentOption[] = [
  { id: "standard", name: "Standard Delivery" },
  { id: "express", name: "Express Delivery" },
]

const VALID_OPTION_IDS = new Set(FULFILLMENT_OPTIONS.map((o) => o.id))

// ── Service ─────────────────────────────────────────────────────────────────

export default class ShiprocketFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "shiprocket"

  private readonly shiprocket: ShiprocketProvider

  constructor() {
    super()
    this.shiprocket = new ShiprocketProvider({ env: process.env })
  }

  // ── Option discovery ──────────────────────────────────────────────────────
  // Called by Medusa admin when admin adds a shipping option to a region.

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return FULFILLMENT_OPTIONS
  }

  // ── Option validation ─────────────────────────────────────────────────────
  // Called when admin saves a shipping option.

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return typeof data.id === "string" && VALID_OPTION_IDS.has(data.id)
  }

  // ── Fulfillment data validation ───────────────────────────────────────────
  // Called when a customer selects a shipping method at checkout.
  // Returned value is stored in the shipping method's `data` property.

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: unknown
  ): Promise<Record<string, unknown>> {
    return { ...data, option_id: optionData.id }
  }

  // ── Pricing ───────────────────────────────────────────────────────────────
  // Fixed pricing — admin sets the rate in the Medusa admin UI.
  // canCalculate returning false tells Medusa not to call calculatePrice.

  async canCalculate(
    _data: CreateShippingOptionDTO
  ): Promise<boolean> {
    return false
  }

  async calculatePrice(
    _optionData: CalculateShippingOptionPriceDTO["optionData"],
    _data: CalculateShippingOptionPriceDTO["data"],
    _context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    // Never called for flat-rate options (canCalculate returns false).
    return { calculated_amount: 0, is_calculated_price_tax_inclusive: false }
  }

  // ── Fulfillment creation ──────────────────────────────────────────────────
  // Called when admin clicks "Create Fulfillment" on an order.
  // Books the shipment with Shiprocket and returns shipment data + labels.

  async createFulfillment(
    data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    if (!order) {
      return { data: { ...data }, labels: [] }
    }

    let contract
    try {
      contract = buildShipmentContract(order as Parameters<typeof buildShipmentContract>[0])
    } catch (err) {
      if (
        err instanceof ShipmentContractBuildError ||
        err instanceof LogisticsValidationError
      ) {
        throw new Error(
          `Cannot create Shiprocket shipment: ${err.message}. ` +
          `Ensure each variant has valid weight and dimensions (metadata.weight_grams/dimensions_cm or native variant weight/length/width/height).`
        )
      }
      throw err
    }

    const correlationId = fulfillment.id ?? contract.order_id

    const response = await this.shiprocket.createShipment({
      internal_reference: contract.order_id,
      idempotency_key: correlationId,
      correlation_id: correlationId,
      order_reference: contract.invoice_ref,
      currency_code: "INR",
      pickup_address: contract.pickup_address,
      delivery_address: contract.delivery_address,
      parcels: contract.packages.map((pkg) => ({
        weight_grams: pkg.weight_grams,
        dimensions_cm: pkg.dimensions_cm,
      })),
      line_items: contract.packages.flatMap((pkg) =>
        pkg.items.map((item) => ({
          sku: item.sku,
          name: item.name,
          qty: item.qty,
        }))
      ),
      cod: contract.cod,
      notes: contract.notes,
    })

    const labels: CreateFulfillmentResult["labels"] = []
    if (response.tracking_number) {
      labels.push({
        tracking_number: response.tracking_number,
        tracking_url: response.tracking_url ?? "",
        label_url: response.label?.label_url ?? "",
      })
    }

    return {
      data: {
        ...data,
        shipment_id: response.shipment_id,
        tracking_number: response.tracking_number ?? null,
        tracking_url: response.tracking_url ?? null,
        status: response.status,
      },
      labels,
    }
  }

  // ── Fulfillment cancellation ──────────────────────────────────────────────
  // Called when admin cancels a fulfillment.

  async cancelFulfillment(data: Record<string, unknown>): Promise<void> {
    const shipmentId =
      typeof data.shipment_id === "string" ? data.shipment_id : null
    if (!shipmentId) {
      return
    }

    await this.shiprocket.cancel({
      shipment_id: shipmentId,
      reason: "Cancelled from Medusa admin",
      correlation_id: shipmentId,
    })
  }

  // ── Return fulfillment ────────────────────────────────────────────────────
  // Shiprocket reverse logistics is a future task. Returns a stub for now.

  async createReturnFulfillment(
    fulfillment: Record<string, unknown>
  ): Promise<CreateFulfillmentResult> {
    return { data: { ...fulfillment }, labels: [] }
  }

  // ── Document methods ──────────────────────────────────────────────────────

  async getFulfillmentDocuments(
    _data: Record<string, unknown>
  ): Promise<never[]> {
    return []
  }

  async getReturnDocuments(_data: Record<string, unknown>): Promise<never[]> {
    return []
  }

  async getShipmentDocuments(
    _data: Record<string, unknown>
  ): Promise<never[]> {
    return []
  }

  async retrieveDocuments(
    _fulfillmentData: Record<string, unknown>,
    _documentType: string
  ): Promise<void> {
    return
  }
}
