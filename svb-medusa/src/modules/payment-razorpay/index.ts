import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import RazorpayPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [RazorpayPaymentProviderService],
})

export * from "./contract-provider"
