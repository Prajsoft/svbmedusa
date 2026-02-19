import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { buildProductFeedXmlStep } from "./steps/build-product-feed-xml"
import { getProductFeedItemsStep } from "./steps/get-product-feed-items"

export type GenerateProductFeedWorkflowInput = {
  currency_code: string
  country_code: string
}

export const generateProductFeedWorkflow = createWorkflow(
  "generate-product-feed",
  (input: GenerateProductFeedWorkflowInput) => {
    const feedData = getProductFeedItemsStep(input)
    const xml = buildProductFeedXmlStep({
      items: feedData.items,
    })

    return new WorkflowResponse({ xml })
  }
)
