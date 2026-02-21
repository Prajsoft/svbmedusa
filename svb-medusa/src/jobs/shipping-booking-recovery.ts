import type { MedusaContainer } from "@medusajs/framework/types"
import { runShippingBookingRecovery } from "../modules/shipping/booking-recovery"

export default async function shippingBookingRecoveryJob(
  container: MedusaContainer
) {
  await runShippingBookingRecovery(container as any)
}

export const config = {
  name: "shipping-booking-recovery",
  schedule:
    process.env.SHIPPING_BOOKING_RECOVERY_CRON || "*/10 * * * *",
}

