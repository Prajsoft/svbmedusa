import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { buildInvoiceData } from "../../../../modules/invoice/generator"
import { generateInvoicePdf } from "../../../../modules/invoice/pdf"

function readText(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/**
 * GET /store/invoice/:order_id
 *
 * Generates and streams a GST-compliant PDF invoice for the given order.
 * No session auth is required — the UUID order_id is sufficient access control
 * (consistent with the shipment tracking endpoint).
 *
 * Env vars used for seller details:
 *   INVOICE_SELLER_NAME, INVOICE_SELLER_ADDRESS, INVOICE_SELLER_GSTIN,
 *   INVOICE_SELLER_PAN, INVOICE_SELLER_EMAIL, INVOICE_SELLER_PHONE
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = readText(req.params?.order_id)

  if (!orderId) {
    res
      .status(400)
      .json({ code: "ORDER_ID_REQUIRED", message: "order_id is required." })
    return
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "created_at",
        "currency_code",
        "subtotal",
        "discount_total",
        "shipping_total",
        "tax_total",
        "total",
        "metadata",
        "billing_address.first_name",
        "billing_address.last_name",
        "billing_address.address_1",
        "billing_address.address_2",
        "billing_address.city",
        "billing_address.province",
        "billing_address.postal_code",
        "billing_address.country_code",
        "billing_address.phone",
        "items.id",
        "items.title",
        "items.product_title",
        "items.quantity",
        "items.unit_price",
        "items.subtotal",
        "items.total",
        "items.tax_total",
        "items.metadata",
        "items.tax_lines.rate",
        "items.tax_lines.total",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0]

    if (!order) {
      res
        .status(404)
        .json({ code: "ORDER_NOT_FOUND", message: "Order not found." })
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoiceData = buildInvoiceData(order as any)
    const pdfBuffer = await generateInvoicePdf(invoiceData)

    const filename = `invoice-${invoiceData.invoiceNumber}.pdf`
    res
      .status(200)
      .setHeader("Content-Type", "application/pdf")
      .setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      .setHeader("Content-Length", String(pdfBuffer.length))
      .end(pdfBuffer)
  } catch {
    res.status(500).json({
      code: "INVOICE_ERROR",
      message: "Unable to generate invoice.",
    })
  }
}
