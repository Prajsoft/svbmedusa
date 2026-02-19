import { model } from "@medusajs/framework/utils"

const BusinessEvent = model.define("business_event", {
  id: model.id().primaryKey(),
  name: model.text(),
  payload: model.json(),
  correlation_id: model.text(),
  entity_refs: model.json().nullable(),
  actor: model.json().nullable(),
  schema_version: model.text(),
})

export default BusinessEvent
