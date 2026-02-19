import {
  LogisticsValidationError,
  validateLogistics,
} from "../catalog/validate-logistics"

const DEFAULT_PICKUP_LOCATION_CODE = "WH-MRT-01"
const COD_PAYMENT_PROVIDER_ID = "pp_cod_cod"
const SMALL_SHIPPING_CLASS = "SMALL"

type AddressLike = {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  phone?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
  country_code?: string | null
}

type VariantLike = {
  id?: string
  sku?: string | null
  title?: string | null
  metadata?: Record<string, unknown> | null
}

type LineItemLike = {
  id?: string
  title?: string | null
  quantity?: number | string | null
  variant?: VariantLike | null
}

type PaymentLike = {
  provider_id?: string | null
  amount?: number | string | null
}

type PaymentCollectionLike = {
  payments?: PaymentLike[] | null
}

type OrderLike = {
  id: string
  display_id?: string | number | null
  shipping_address?: AddressLike | null
  items?: LineItemLike[] | null
  payment_collections?: PaymentCollectionLike[] | null
  total?: number | string | null
  metadata?: Record<string, unknown> | null
}

export type ShipmentContract = {
  order_id: string
  pickup_location_code: string
  pickup_address: {
    name: string
    phone: string
    line1: string
    line2?: string
    city: string
    state: string
    postal_code: string
    country_code: string
  }
  delivery_address: {
    name: string
    phone: string
    line1: string
    line2?: string
    city: string
    state: string
    postal_code: string
    country_code: string
  }
  packages: Array<{
    weight_grams: number
    dimensions_cm: {
      l: number
      w: number
      h: number
    }
    items: Array<{
      sku: string
      qty: number
      name: string
    }>
  }>
  cod: {
    enabled: boolean
    amount: number
  }
  invoice_ref: string
  notes?: string
}

export class ShipmentContractBuildError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "ShipmentContractBuildError"
    this.code = code
  }
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toNumber(value)
  if (parsed <= 0) {
    return null
  }

  return parsed
}

function toPositiveInt(value: unknown): number {
  const parsed = Math.floor(toNumber(value))
  return parsed > 0 ? parsed : 0
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function buildName(address: AddressLike | null | undefined): string {
  if (!address) {
    return ""
  }

  const fullName = [address.first_name, address.last_name].filter(Boolean).join(" ").trim()
  if (fullName) {
    return fullName
  }

  return (address.company ?? "").trim()
}

function mapAddress(address: AddressLike | null | undefined) {
  return {
    name: buildName(address),
    phone: (address?.phone ?? "").trim(),
    line1: (address?.address_1 ?? "").trim(),
    line2: (address?.address_2 ?? "").trim() || undefined,
    city: (address?.city ?? "").trim(),
    state: (address?.province ?? "").trim(),
    postal_code: (address?.postal_code ?? "").trim(),
    country_code: (address?.country_code ?? "").trim().toUpperCase(),
  }
}

function buildPickupAddress() {
  return {
    name: process.env.SVB_PICKUP_NAME?.trim() || "SVB Sports Warehouse",
    phone: process.env.SVB_PICKUP_PHONE?.trim() || "",
    line1: process.env.SVB_PICKUP_ADDRESS_LINE1?.trim() || "",
    line2: process.env.SVB_PICKUP_ADDRESS_LINE2?.trim() || undefined,
    city: process.env.SVB_PICKUP_CITY?.trim() || "",
    state: process.env.SVB_PICKUP_STATE?.trim() || "",
    postal_code: process.env.SVB_PICKUP_POSTAL_CODE?.trim() || "",
    country_code: (process.env.SVB_PICKUP_COUNTRY_CODE?.trim() || "IN").toUpperCase(),
  }
}

function getItemDisplayName(item: LineItemLike, sku: string): string {
  return (item.title ?? item.variant?.title ?? sku).trim()
}

function getItemSku(item: LineItemLike): string {
  return (item.variant?.sku ?? item.variant?.id ?? item.id ?? "unknown").trim()
}

function ensureItemLogistics(item: LineItemLike): {
  qty: number
  sku: string
  name: string
  weightGrams: number
  dimensions: { l: number; w: number; h: number }
  shippingClass: string
} {
  const qty = toPositiveInt(item.quantity)
  if (qty <= 0) {
    throw new ShipmentContractBuildError(
      "INVALID_LINE_ITEM",
      `Line item ${item.id ?? "unknown"} has invalid quantity.`
    )
  }

  const variant = item.variant
  if (!variant) {
    throw new LogisticsValidationError(
      `Line item ${item.id ?? "unknown"} is missing variant logistics metadata.`
    )
  }

  const logistics = validateLogistics(variant)
  if (!logistics.ok) {
    throw new LogisticsValidationError(logistics.message)
  }

  const metadata = (variant.metadata ?? {}) as Record<string, unknown>
  const dimensions = (metadata.dimensions_cm ?? {}) as {
    l?: unknown
    w?: unknown
    h?: unknown
  }

  const weightGrams = toPositiveNumber(metadata.weight_grams) as number
  const l = toPositiveNumber(dimensions.l) as number
  const w = toPositiveNumber(dimensions.w) as number
  const h = toPositiveNumber(dimensions.h) as number
  const shippingClass = String(metadata.shipping_class ?? "").toUpperCase()

  return {
    qty,
    sku: getItemSku(item),
    name: getItemDisplayName(item, getItemSku(item)),
    weightGrams,
    dimensions: { l, w, h },
    shippingClass,
  }
}

function buildSinglePackage(items: LineItemLike[]) {
  let totalWeight = 0
  let maxL = 0
  let maxW = 0
  let totalH = 0

  const packageItems: Array<{ sku: string; qty: number; name: string }> = []

  for (const item of items) {
    const parsed = ensureItemLogistics(item)

    if (parsed.shippingClass !== SMALL_SHIPPING_CLASS) {
      throw new ShipmentContractBuildError(
        "UNSUPPORTED_SHIPPING_CLASS",
        `v1 supports only ${SMALL_SHIPPING_CLASS} shipping_class for packaging.`
      )
    }

    totalWeight += parsed.weightGrams * parsed.qty
    maxL = Math.max(maxL, parsed.dimensions.l)
    maxW = Math.max(maxW, parsed.dimensions.w)
    totalH += parsed.dimensions.h * parsed.qty

    packageItems.push({
      sku: parsed.sku,
      qty: parsed.qty,
      name: parsed.name,
    })
  }

  return {
    weight_grams: roundTo2(totalWeight),
    dimensions_cm: {
      l: roundTo2(maxL),
      w: roundTo2(maxW),
      h: roundTo2(totalH),
    },
    items: packageItems,
  }
}

function getPayments(order: OrderLike): PaymentLike[] {
  const collections = Array.isArray(order.payment_collections)
    ? order.payment_collections
    : []

  const payments: PaymentLike[] = []
  for (const collection of collections) {
    for (const payment of collection.payments ?? []) {
      payments.push(payment)
    }
  }

  return payments
}

function getCodDetails(order: OrderLike): { enabled: boolean; amount: number } {
  const codPayments = getPayments(order).filter(
    (payment) => payment.provider_id === COD_PAYMENT_PROVIDER_ID
  )

  if (!codPayments.length) {
    return { enabled: false, amount: 0 }
  }

  const amountFromPayments = roundTo2(
    codPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0)
  )

  if (amountFromPayments > 0) {
    return { enabled: true, amount: amountFromPayments }
  }

  return { enabled: true, amount: roundTo2(toNumber(order.total)) }
}

function getInvoiceRef(order: OrderLike): string {
  if (order.display_id !== undefined && order.display_id !== null) {
    return String(order.display_id)
  }

  return order.id
}

export function buildShipmentContract(order: OrderLike): ShipmentContract {
  const items = Array.isArray(order.items) ? order.items : []
  if (!items.length) {
    throw new ShipmentContractBuildError(
      "EMPTY_ORDER_ITEMS",
      `Order ${order.id} has no shippable items.`
    )
  }

  const notes =
    typeof order.metadata?.shipment_notes === "string"
      ? order.metadata.shipment_notes.trim()
      : ""

  return {
    order_id: order.id,
    pickup_location_code:
      process.env.SVB_PICKUP_LOCATION_CODE?.trim() || DEFAULT_PICKUP_LOCATION_CODE,
    pickup_address: buildPickupAddress(),
    delivery_address: mapAddress(order.shipping_address),
    packages: [buildSinglePackage(items)],
    cod: getCodDetails(order),
    invoice_ref: getInvoiceRef(order),
    notes: notes || undefined,
  }
}
