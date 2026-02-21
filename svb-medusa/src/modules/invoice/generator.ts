import type { HttpTypes } from "@medusajs/types"

export type InvoiceLineItem = {
  sno: number
  description: string
  hsn: string
  qty: number
  unitPrice: number     // INR
  taxableAmount: number // INR
  cgstRate: number
  cgstAmount: number    // INR
  sgstRate: number
  sgstAmount: number    // INR
  total: number         // INR
}

export type InvoiceData = {
  invoiceNumber: string
  invoiceDate: string
  seller: {
    name: string
    address: string
    gstin: string
    pan: string
    email: string
    phone: string
  }
  buyer: {
    name: string
    address: string
    gstin?: string
    phone?: string
  }
  lineItems: InvoiceLineItem[]
  subtotal: number
  discountTotal: number
  shippingTotal: number
  cgstTotal: number
  sgstTotal: number
  taxTotal: number
  total: number
  amountInWords: string
}

// Convert paise → INR
function fromPaise(v: number | null | undefined): number {
  return (v ?? 0) / 100
}

function formatAddress(
  addr?: HttpTypes.StoreOrderAddress | null
): string {
  if (!addr) return ""
  return [
    addr.address_1,
    addr.address_2,
    addr.city,
    addr.province,
    addr.postal_code,
    addr.country_code?.toUpperCase(),
  ]
    .filter(Boolean)
    .join(", ")
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

// ── Indian number-to-words ────────────────────────────────────────────────────

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
]
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
]

function toWords(n: number): string {
  if (n === 0) return "Zero"
  if (n < 20) return ONES[n]
  if (n < 100)
    return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")
  if (n < 1000)
    return (
      ONES[Math.floor(n / 100)] +
      " Hundred" +
      (n % 100 ? " " + toWords(n % 100) : "")
    )
  if (n < 100000)
    return (
      toWords(Math.floor(n / 1000)) +
      " Thousand" +
      (n % 1000 ? " " + toWords(n % 1000) : "")
    )
  if (n < 10000000)
    return (
      toWords(Math.floor(n / 100000)) +
      " Lakh" +
      (n % 100000 ? " " + toWords(n % 100000) : "")
    )
  return (
    toWords(Math.floor(n / 10000000)) +
    " Crore" +
    (n % 10000000 ? " " + toWords(n % 10000000) : "")
  )
}

function amountInWords(totalPaise: number): string {
  const rupees = Math.round(totalPaise / 100)
  return "Indian Rupees " + toWords(rupees) + " Only"
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildInvoiceData(order: HttpTypes.StoreOrder): InvoiceData {
  const lineItems: InvoiceLineItem[] = (order.items ?? []).map((item, i) => {
    const subtotalPaise =
      item.subtotal ?? (item.unit_price ?? 0) * (item.quantity ?? 1)
    const taxPaise = item.tax_total ?? 0

    const firstTaxLine = (
      item.tax_lines as { rate?: number }[] | undefined
    )?.[0]
    const totalGstRate = firstTaxLine?.rate ?? 12

    const cgstPaise = Math.round(taxPaise / 2)
    const sgstPaise = taxPaise - cgstPaise

    return {
      sno: i + 1,
      description: item.product_title ?? item.title ?? "Product",
      hsn: (item.metadata?.hsn_code as string | undefined) ?? "9506",
      qty: item.quantity ?? 1,
      unitPrice: fromPaise(subtotalPaise / (item.quantity ?? 1)),
      taxableAmount: fromPaise(subtotalPaise),
      cgstRate: totalGstRate / 2,
      cgstAmount: fromPaise(cgstPaise),
      sgstRate: totalGstRate / 2,
      sgstAmount: fromPaise(sgstPaise),
      total: fromPaise(item.total ?? 0),
    }
  })

  const taxPaise = order.tax_total ?? 0
  const cgstTotalPaise = Math.round(taxPaise / 2)
  const sgstTotalPaise = taxPaise - cgstTotalPaise

  const billing = order.billing_address
  const buyerName =
    [billing?.first_name, billing?.last_name].filter(Boolean).join(" ") ||
    "Customer"

  return {
    invoiceNumber: `INV-${order.display_id}`,
    invoiceDate: formatDate(order.created_at),
    seller: {
      name: process.env.INVOICE_SELLER_NAME ?? "SVB Sports",
      address:
        process.env.INVOICE_SELLER_ADDRESS ?? "Mumbai, Maharashtra, India",
      gstin: process.env.INVOICE_SELLER_GSTIN ?? "",
      pan: process.env.INVOICE_SELLER_PAN ?? "",
      email: process.env.INVOICE_SELLER_EMAIL ?? "",
      phone: process.env.INVOICE_SELLER_PHONE ?? "",
    },
    buyer: {
      name: buyerName,
      address: formatAddress(billing),
      gstin: order.metadata?.gstin as string | undefined,
      phone: billing?.phone ?? undefined,
    },
    lineItems,
    subtotal: fromPaise(order.subtotal ?? 0),
    discountTotal: fromPaise(order.discount_total ?? 0),
    shippingTotal: fromPaise(order.shipping_total ?? 0),
    cgstTotal: fromPaise(cgstTotalPaise),
    sgstTotal: fromPaise(sgstTotalPaise),
    taxTotal: fromPaise(taxPaise),
    total: fromPaise(order.total ?? 0),
    amountInWords: amountInWords(order.total ?? 0),
  }
}
