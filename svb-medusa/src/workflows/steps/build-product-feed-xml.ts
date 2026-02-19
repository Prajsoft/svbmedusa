import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import type { FeedItem } from "./get-product-feed-items"

export type BuildProductFeedXmlInput = {
  items: FeedItem[]
}

const GOOGLE_NAMESPACE = "http://base.google.com/ns/1.0"
const CHANNEL_TITLE = "SVB Sports Product Feed"
const CHANNEL_DESCRIPTION = "SVB Sports catalog feed for Google and Meta."

function readText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function escapeXml(value: unknown): string {
  const text = readText(value)
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function toTag(name: string, value: unknown): string {
  return `<${name}>${escapeXml(value)}</${name}>`
}

function toOptionalTag(name: string, value: unknown): string {
  const text = readText(value).trim()
  if (!text) {
    return ""
  }

  return toTag(name, text)
}

function toAdditionalImageTags(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }

  return values
    .map((value) => readText(value).trim())
    .filter(Boolean)
    .map((value) => toTag("g:additional_image_link", value))
}

function getChannelLink(): string {
  return readText(process.env.STOREFRONT_URL).trim()
}

function normalizeItems(items: unknown): FeedItem[] {
  if (!Array.isArray(items)) {
    return []
  }

  return items as FeedItem[]
}

function toItemXml(item: FeedItem): string {
  const imageLink = readText(item.image_link).trim()

  const lines = [
    "    <item>",
    `      ${toTag("g:id", item.id ?? "")}`,
    `      ${toTag("title", item.title ?? "")}`,
    `      ${toTag("description", item.description ?? "")}`,
    `      ${toTag("link", item.link ?? "")}`,
  ]

  if (imageLink) {
    lines.push(`      ${toTag("g:image_link", imageLink)}`)
  }

  const additionalImageTags = toAdditionalImageTags(item.additional_image_links)
  for (const imageTag of additionalImageTags) {
    lines.push(`      ${imageTag}`)
  }

  lines.push(`      ${toTag("g:availability", item.availability ?? "")}`)
  lines.push(`      ${toTag("g:price", item.price ?? "")}`)

  const salePriceTag = toOptionalTag("g:sale_price", item.sale_price)
  if (salePriceTag) {
    lines.push(`      ${salePriceTag}`)
  }

  lines.push(`      ${toTag("g:condition", item.condition ?? "new")}`)

  const brandTag = toOptionalTag("g:brand", item.brand)
  if (brandTag) {
    lines.push(`      ${brandTag}`)
  }

  lines.push(`      ${toTag("g:item_group_id", item.item_group_id ?? "")}`)
  lines.push("    </item>")

  return lines.join("\n")
}

export function buildProductFeedXml(input: BuildProductFeedXmlInput): string {
  const items = normalizeItems(input?.items)
  const now = new Date().toUTCString()

  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" xmlns:g="${GOOGLE_NAMESPACE}">`,
    "  <channel>",
    `    ${toTag("title", CHANNEL_TITLE)}`,
    `    ${toTag("description", CHANNEL_DESCRIPTION)}`,
    `    ${toTag("link", getChannelLink())}`,
    `    ${toTag("lastBuildDate", now)}`,
  ]

  for (const item of items) {
    xmlLines.push(toItemXml(item))
  }

  xmlLines.push("  </channel>")
  xmlLines.push("</rss>")

  return xmlLines.join("\n")
}

export const buildProductFeedXmlStep = createStep(
  "build-product-feed-xml",
  async (input: BuildProductFeedXmlInput) => {
    const xml = buildProductFeedXml(input)
    return new StepResponse(xml)
  }
)
