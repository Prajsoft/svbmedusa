import { spawnSync } from "node:child_process"
import { ExecArgs } from "@medusajs/framework/types"
import {
  buildProductFeedXml,
  type BuildProductFeedXmlInput,
} from "../workflows/steps/build-product-feed-xml"
import { getProductFeedItems } from "../workflows/steps/get-product-feed-items"

function hasFlag(args: string[] | undefined, flag: string): boolean {
  return Array.isArray(args) && args.includes(flag)
}

function readArg(args: string[] | undefined, index: number): string {
  if (!Array.isArray(args)) {
    return ""
  }

  const value = args[index]
  return typeof value === "string" ? value.trim() : ""
}

function getSampleInput(): BuildProductFeedXmlInput {
  return {
    items: [
      {
        id: "variant_sample_001",
        title: "Blitz+ Cricket Ball",
        description: "Premium leather ball for match play & training",
        link: "https://www.svbsports.com/in/products/blitzp",
        image_link: "https://cdn.example.com/products/blitzp/main.png",
        additional_image_links: [
          "https://cdn.example.com/products/blitzp/angle-1.png",
          "https://cdn.example.com/products/blitzp/angle-2.png",
        ],
        availability: "in stock",
        price: "899.00 INR",
        sale_price: "999.00 INR",
        item_group_id: "prod_sample_001",
        condition: "new",
        brand: "SVB Sports",
      },
      {
        id: "variant_sample_002",
        title: "Swift Plus Cricket Ball",
        description: "Training-grade durable ball",
        link: "https://www.svbsports.com/in/products/swiftp",
        image_link: "https://cdn.example.com/products/swiftp/main.png",
        additional_image_links: [],
        availability: "out of stock",
        price: "599.00 INR",
        item_group_id: "prod_sample_002",
        condition: "new",
      },
    ],
  }
}

function runXmlLint(xml: string): void {
  const result = spawnSync("xmllint", ["--noout", "-"], {
    input: xml,
    encoding: "utf8",
  })

  if (result.error) {
    throw new Error(
      "xmllint not found in PATH. Install libxml2/xmllint and rerun the script."
    )
  }

  if (result.status !== 0) {
    const errorOutput = result.stderr?.trim() || "xmllint validation failed."
    throw new Error(errorOutput)
  }
}

function printFirstLines(xml: string, maxLines: number): void {
  const lines = xml.split(/\r?\n/).slice(0, maxLines)
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"))
}

export default async function testProductFeedXml({
  container,
  args,
}: ExecArgs): Promise<void> {
  const useLiveItems = hasFlag(args, "--live")
  const currencyCode = (readArg(args, 0) || "INR").toUpperCase()
  const countryCode = (readArg(args, 1) || "IN").toUpperCase()

  let input: BuildProductFeedXmlInput = getSampleInput()
  if (useLiveItems) {
    const itemsResult = await getProductFeedItems(container as any, {
      currency_code: currencyCode,
      country_code: countryCode,
    })
    input = { items: itemsResult.items }

    // eslint-disable-next-line no-console
    console.log(
      `[product-feed-xml-test] using live items: ${itemsResult.items.length} (skipped=${itemsResult.skipped_variants.length}, warnings=${itemsResult.warnings.length})`
    )
  } else {
    // eslint-disable-next-line no-console
    console.log("[product-feed-xml-test] using sample items")
  }

  const xml = buildProductFeedXml(input)
  runXmlLint(xml)

  // eslint-disable-next-line no-console
  console.log("[product-feed-xml-test] xmllint passed")
  // eslint-disable-next-line no-console
  console.log("[product-feed-xml-test] first 40 lines:")
  printFirstLines(xml, 40)
}
