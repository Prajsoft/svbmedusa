import { MedusaService } from "@medusajs/framework/utils"
import BusinessEvent from "./models/business-event"

class ObservabilityModuleService extends MedusaService({
  BusinessEvent,
}) {}

export default ObservabilityModuleService
