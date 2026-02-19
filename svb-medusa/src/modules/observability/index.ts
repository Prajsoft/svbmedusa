import { Module } from "@medusajs/framework/utils"
import ObservabilityModuleService from "./service"

export const OBSERVABILITY_MODULE = "observability"

export default Module(OBSERVABILITY_MODULE, {
  service: ObservabilityModuleService,
})
