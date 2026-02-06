import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import type {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import { Resend } from "resend"

type InjectedDependencies = {
  logger: Logger
}

type ResendOptions = {
  api_key: string
  from: string
}

interface OrderItem {
  title?: string
  quantity?: number
  unit_price?: number
}

interface OrderAddress {
  first_name?: string
  last_name?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
  phone?: string
}

interface OrderData {
  display_id?: number
  email?: string
  currency_code?: string
  total?: number
  subtotal?: number
  shipping_total?: number
  tax_total?: number
  discount_total?: number
  items?: OrderItem[]
  shipping_address?: OrderAddress
}

class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-resend"

  private resendClient: Resend
  private from: string
  private logger: Logger

  constructor({ logger }: InjectedDependencies, options: ResendOptions) {
    super()
    this.resendClient = new Resend(options.api_key)
    this.from = options.from
    this.logger = logger
  }

  static validateOptions(options: Record<string, unknown>) {
    if (!options.api_key) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `api_key` is required for the Resend notification provider."
      )
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `from` is required for the Resend notification provider."
      )
    }
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const { to, template, data } = notification

    const subject = this.getSubject(template, data as Record<string, unknown>)
    const html = this.getHtml(template, data as Record<string, unknown>)

    this.logger.info(`Sending "${template}" email to ${to}`)

    const { data: result, error } = await this.resendClient.emails.send({
      from: this.from,
      to: [to],
      subject,
      html,
    })

    if (error || !result) {
      this.logger.error(
        `Failed to send "${template}" email to ${to}: ${JSON.stringify(error)}`
      )
      return {}
    }

    this.logger.info(`Email sent to ${to} — Resend ID: ${result.id}`)
    return { id: result.id }
  }

  private getSubject(
    template: string,
    data?: Record<string, unknown>
  ): string {
    const order = data?.order as OrderData | undefined

    switch (template) {
      case "order-placed":
        return order?.display_id
          ? `SVB Sports — Order #${order.display_id} Confirmed`
          : "SVB Sports — Order Confirmed"
      default:
        return "SVB Sports — Notification"
    }
  }

  private getHtml(
    template: string,
    data?: Record<string, unknown>
  ): string {
    switch (template) {
      case "order-placed":
        return this.orderPlacedHtml(data?.order as OrderData | undefined)
      default:
        return `<p>You have a new notification from SVB Sports.</p>`
    }
  }

  private formatCurrency(amount: number, currency: string): string {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount)
  }

  private orderPlacedHtml(order?: OrderData): string {
    if (!order) {
      return `<p>Thank you for your order with SVB Sports!</p>`
    }

    const currency = order.currency_code || "INR"
    const items = order.items || []
    const address = order.shipping_address

    const itemRows = items
      .map(
        (item) =>
          `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee">${item.title || "Product"}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${item.quantity || 1}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${this.formatCurrency((item.unit_price || 0) / 100, currency)}</td>
          </tr>`
      )
      .join("")

    const addressBlock = address
      ? `<p style="margin:0;line-height:1.6">
          ${address.first_name || ""} ${address.last_name || ""}<br>
          ${address.address_1 || ""}${address.address_2 ? ", " + address.address_2 : ""}<br>
          ${address.city || ""}${address.province ? ", " + address.province : ""} ${address.postal_code || ""}<br>
          ${address.phone ? "Phone: " + address.phone : ""}
        </p>`
      : ""

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff">

    <!-- Header -->
    <div style="background:#1a1a2e;padding:24px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:22px">SVB Sports</h1>
    </div>

    <!-- Body -->
    <div style="padding:24px">
      <h2 style="margin:0 0 8px;color:#1a1a2e">Order Confirmed!</h2>
      <p style="margin:0 0 20px;color:#666">
        Thank you for your order <strong>#${order.display_id || ""}</strong>.
        We're getting it ready for you.
      </p>

      <!-- Items Table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <thead>
          <tr style="background:#f9f9f9">
            <th style="padding:8px 12px;text-align:left;font-size:13px;color:#666">Item</th>
            <th style="padding:8px 12px;text-align:center;font-size:13px;color:#666">Qty</th>
            <th style="padding:8px 12px;text-align:right;font-size:13px;color:#666">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <!-- Totals -->
      <table style="width:100%;margin-bottom:20px">
        <tr>
          <td style="padding:4px 0;color:#666">Subtotal</td>
          <td style="padding:4px 0;text-align:right">${this.formatCurrency((order.subtotal || 0) / 100, currency)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#666">Shipping</td>
          <td style="padding:4px 0;text-align:right">${this.formatCurrency((order.shipping_total || 0) / 100, currency)}</td>
        </tr>
        ${
          order.discount_total
            ? `<tr>
                <td style="padding:4px 0;color:#666">Discount</td>
                <td style="padding:4px 0;text-align:right;color:#16a34a">-${this.formatCurrency(order.discount_total / 100, currency)}</td>
              </tr>`
            : ""
        }
        <tr>
          <td style="padding:4px 0;color:#666">Tax</td>
          <td style="padding:4px 0;text-align:right">${this.formatCurrency((order.tax_total || 0) / 100, currency)}</td>
        </tr>
        <tr style="border-top:2px solid #1a1a2e">
          <td style="padding:8px 0;font-weight:bold;font-size:16px">Total</td>
          <td style="padding:8px 0;text-align:right;font-weight:bold;font-size:16px">${this.formatCurrency((order.total || 0) / 100, currency)}</td>
        </tr>
      </table>

      <!-- Shipping Address -->
      ${
        addressBlock
          ? `<div style="margin-bottom:20px">
              <h3 style="margin:0 0 8px;font-size:14px;color:#666">Shipping Address</h3>
              ${addressBlock}
            </div>`
          : ""
      }

      <p style="margin:20px 0 0;color:#666;font-size:13px">
        If you have any questions, reply to this email or reach out to us on WhatsApp.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f9f9f9;padding:16px 24px;text-align:center;font-size:12px;color:#999">
      <p style="margin:0">SVB Sports — Premium Cricket Equipment</p>
      <p style="margin:4px 0 0">Meerut, India</p>
    </div>

  </div>
</body>
</html>`
  }
}

export default ResendNotificationProviderService
