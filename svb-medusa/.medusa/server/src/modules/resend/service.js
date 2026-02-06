"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const resend_1 = require("resend");
class ResendNotificationProviderService extends utils_1.AbstractNotificationProviderService {
    constructor({ logger }, options) {
        super();
        this.resendClient = new resend_1.Resend(options.api_key);
        this.from = options.from;
        this.logger = logger;
    }
    static validateOptions(options) {
        if (!options.api_key) {
            console.warn("[Resend] RESEND_API_KEY is not set — email sending will be disabled.");
        }
        if (!options.from) {
            console.warn("[Resend] RESEND_FROM_EMAIL is not set — using default sender.");
        }
    }
    async send(notification) {
        if (!this.from) {
            this.logger.warn("Resend: no sender configured — skipping email send.");
            return {};
        }
        const { to, template, data } = notification;
        const subject = this.getSubject(template, data);
        const html = this.getHtml(template, data);
        this.logger.info(`Sending "${template}" email to ${to}`);
        const { data: result, error } = await this.resendClient.emails.send({
            from: this.from,
            to: [to],
            subject,
            html,
        });
        if (error || !result) {
            this.logger.error(`Failed to send "${template}" email to ${to}: ${JSON.stringify(error)}`);
            return {};
        }
        this.logger.info(`Email sent to ${to} — Resend ID: ${result.id}`);
        return { id: result.id };
    }
    getSubject(template, data) {
        const order = data?.order;
        switch (template) {
            case "order-placed":
                return order?.display_id
                    ? `SVB Sports — Order #${order.display_id} Confirmed`
                    : "SVB Sports — Order Confirmed";
            default:
                return "SVB Sports — Notification";
        }
    }
    getHtml(template, data) {
        switch (template) {
            case "order-placed":
                return this.orderPlacedHtml(data?.order);
            default:
                return `<p>You have a new notification from SVB Sports.</p>`;
        }
    }
    formatCurrency(amount, currency) {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: currency.toUpperCase(),
        }).format(amount);
    }
    orderPlacedHtml(order) {
        if (!order) {
            return `<p>Thank you for your order with SVB Sports!</p>`;
        }
        const currency = order.currency_code || "INR";
        const items = order.items || [];
        const address = order.shipping_address;
        const itemRows = items
            .map((item) => `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee">${item.title || "Product"}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${item.quantity || 1}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${this.formatCurrency((item.unit_price || 0) / 100, currency)}</td>
          </tr>`)
            .join("");
        const addressBlock = address
            ? `<p style="margin:0;line-height:1.6">
          ${address.first_name || ""} ${address.last_name || ""}<br>
          ${address.address_1 || ""}${address.address_2 ? ", " + address.address_2 : ""}<br>
          ${address.city || ""}${address.province ? ", " + address.province : ""} ${address.postal_code || ""}<br>
          ${address.phone ? "Phone: " + address.phone : ""}
        </p>`
            : "";
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
        ${order.discount_total
            ? `<tr>
                <td style="padding:4px 0;color:#666">Discount</td>
                <td style="padding:4px 0;text-align:right;color:#16a34a">-${this.formatCurrency(order.discount_total / 100, currency)}</td>
              </tr>`
            : ""}
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
      ${addressBlock
            ? `<div style="margin-bottom:20px">
              <h3 style="margin:0 0 8px;font-size:14px;color:#666">Shipping Address</h3>
              ${addressBlock}
            </div>`
            : ""}

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
</html>`;
    }
}
ResendNotificationProviderService.identifier = "notification-resend";
exports.default = ResendNotificationProviderService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9tb2R1bGVzL3Jlc2VuZC9zZXJ2aWNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEscURBR2tDO0FBTWxDLG1DQUErQjtBQXlDL0IsTUFBTSxpQ0FBa0MsU0FBUSwyQ0FBbUM7SUFPakYsWUFBWSxFQUFFLE1BQU0sRUFBd0IsRUFBRSxPQUFzQjtRQUNsRSxLQUFLLEVBQUUsQ0FBQTtRQUNQLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxlQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQy9DLElBQUksQ0FBQyxJQUFJLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQTtRQUN4QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtJQUN0QixDQUFDO0lBRUQsTUFBTSxDQUFDLGVBQWUsQ0FBQyxPQUFnQztRQUNyRCxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3JCLE9BQU8sQ0FBQyxJQUFJLENBQ1Ysc0VBQXNFLENBQ3ZFLENBQUE7UUFDSCxDQUFDO1FBQ0QsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNsQixPQUFPLENBQUMsSUFBSSxDQUNWLCtEQUErRCxDQUNoRSxDQUFBO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsSUFBSSxDQUNSLFlBQXlDO1FBRXpDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxxREFBcUQsQ0FBQyxDQUFBO1lBQ3ZFLE9BQU8sRUFBRSxDQUFBO1FBQ1gsQ0FBQztRQUVELE1BQU0sRUFBRSxFQUFFLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxHQUFHLFlBQVksQ0FBQTtRQUUzQyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFB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