import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { INotificationModuleService } from "@medusajs/framework/types"

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  console.log("---------------------------------------")
  console.log("🧪 TEST ROUTE: Starting email test...")

  // 1. Resolve the Notification Module
  const notificationModule: INotificationModuleService = req.scope.resolve(
    Modules.NOTIFICATION
  )

  try {
    // 2. Attempt to send a direct notification
    console.log("🧪 TEST ROUTE: Calling createNotifications...")
    
    const toEmail = (req.query.email as string) || process.env.RESEND_TEST_EMAIL || process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev"

    await notificationModule.createNotifications({
      to: toEmail,
      channel: "email",
      template: "order-placed",
      data: {
        order: {
          id: "test-order-123",
          display_id: 99,
          email: toEmail,
          currency_code: "inr",
          total: 65900,
          subtotal: 60000,
          shipping_total: 4900,
          tax_total: 1000,
          discount_total: 0,
          items: [
            { title: "SVB Club Cricket Ball", quantity: 2, unit_price: 30000 },
          ],
          shipping_address: {
            first_name: "Test",
            last_name: "User",
            address_1: "123 Cricket Lane",
            city: "Meerut",
            province: "UP",
            postal_code: "250001",
            phone: "9876543210",
          },
        },
      },
    })

    console.log(`✅ TEST ROUTE: Success! Email sent to ${toEmail}`)
    res.json({ message: `Email test sent to ${toEmail}. Check your inbox.` })

  } catch (error) {
    console.error("❌ TEST ROUTE: Failed.", error)
    res.status(500).json({ code: "EMAIL_ERROR", message: "Unable to send test email." })
  }
}