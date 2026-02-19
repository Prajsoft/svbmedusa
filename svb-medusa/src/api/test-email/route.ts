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
    
    await notificationModule.createNotifications({
      to: "test@example.com", // Replace with your real email if you want
      channel: "email",
      template: "order-placed",
      data: {
        // Mock data to satisfy your React template
        order: {
          id: "test-order-123",
          display_id: 99,
          email: "test@example.com",
          currency_code: "usd",
          total: 5000,
          items: [
            { product_title: "Test Cricket Ball", quantity: 1, unit_price: 5000 }
          ],
          shipping_address: { first_name: "Test User" }
        }
      },
    })

    console.log("✅ TEST ROUTE: Success! Email request sent.")
    res.json({ message: "Email test sent. Check your console and inbox." })

  } catch (error) {
    console.error("❌ TEST ROUTE: Failed.", error)
    res.status(500).json({ 
      message: "Error sending email", 
      error: error.message,
      stack: error.stack 
    })
  }
}