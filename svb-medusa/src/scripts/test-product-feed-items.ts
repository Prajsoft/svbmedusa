import { ExecArgs } from "@medusajs/framework/types"
import {
  getProductFeedItems,
  type SkippedFeedVariant,
} from "../workflows/steps/get-product-feed-items"

function readArg(args: string[] | undefined, index: number): string {
  if (!Array.isArray(args)) {
    return ""
  }

  const raw = args[index]
  return typeof raw === "string" ? raw.trim() : ""
}

function groupSkippedReasons(skipped: SkippedFeedVariant[]): Record<string, number> {
  return skipped.reduce<Record<string, number>>((acc, item) => {
    const reason = item.reason || "UNKNOWN"
    acc[reason] = (acc[reason] ?? 0) + 1
    return acc
  }, {})
}

export default async function testProductFeedItems({
  container,
  args,
}: ExecArgs): Promise<void> {
  const currencyCode = (readArg(args, 0) || "INR").toUpperCase()
  const countryCode = (readArg(args, 1) || "IN").toUpperCase()

  const result = await getProductFeedItems(container as any, {
    currency_code: currencyCode,
    country_code: countryCode,
  })

  // eslint-disable-next-line no-console
  console.log(`[product-feed-test] currency=${currencyCode} country=${countryCode}`)
  // eslint-disable-next-line no-console
  console.log(`[product-feed-test] total items: ${result.items.length}`)
  // eslint-disable-next-line no-console
  console.log("[product-feed-test] first 2 items:")
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result.items.slice(0, 2), null, 2))
  // eslint-disable-next-line no-console
  console.log(`[product-feed-test] skipped variants: ${result.skipped_variants.length}`)
  // eslint-disable-next-line no-console
  console.log("[product-feed-test] skipped reasons:")
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(groupSkippedReasons(result.skipped_variants), null, 2))
  // eslint-disable-next-line no-console
  console.log(`[product-feed-test] warnings: ${result.warnings.length}`)
}
