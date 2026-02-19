import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { ExecArgs } from "@medusajs/framework/types"
import { generateProductFeedWorkflow } from "../workflows/generate-product-feed"

function readArg(args: string[] | undefined, index: number): string {
  if (!Array.isArray(args)) {
    return ""
  }

  const raw = args[index]
  return typeof raw === "string" ? raw.trim() : ""
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

export default async function testGenerateProductFeed({
  container,
  args,
}: ExecArgs): Promise<void> {
  const currencyCode = (readArg(args, 0) || "INR").toUpperCase()
  const countryCode = (readArg(args, 1) || "IN").toUpperCase()

  const { result } = await generateProductFeedWorkflow(container).run({
    input: {
      currency_code: currencyCode,
      country_code: countryCode,
    },
  })

  const xml = typeof result?.xml === "string" ? result.xml : ""
  if (!xml.trim()) {
    throw new Error("generate-product-feed returned empty xml output.")
  }

  const outputPath = join(tmpdir(), "product-feed.xml")
  writeFileSync(outputPath, xml, "utf8")

  runXmlLint(xml)

  // eslint-disable-next-line no-console
  console.log(`[generate-product-feed-test] currency=${currencyCode} country=${countryCode}`)
  // eslint-disable-next-line no-console
  console.log(`[generate-product-feed-test] wrote xml: ${outputPath}`)
  // eslint-disable-next-line no-console
  console.log("[generate-product-feed-test] xmllint passed")
  // eslint-disable-next-line no-console
  console.log("[generate-product-feed-test] first 50 lines:")
  printFirstLines(xml, 50)
}
