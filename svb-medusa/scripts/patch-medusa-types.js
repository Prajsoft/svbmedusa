/**
 * patch-medusa-types.js
 *
 * Injects the `sports_attributes` field into the auto-generated Product type
 * in .medusa/types/query-entry-points.d.ts.
 *
 * Why this is needed:
 *   `sports_attributes` is a raw JSONB column added directly to the `product`
 *   table by Migration20260223000000.  Medusa generates query-entry-points.d.ts
 *   from its internal GQL schema, which does not include raw columns added
 *   outside the ORM.  After every `medusa develop` (which cleans and
 *   regenerates .medusa/types/), this script must be re-run to restore type
 *   safety for `sports_attributes`.
 *
 * Usage:
 *   yarn patch:types           — run manually after `medusa develop`
 *   (postbuild runs it automatically after `medusa build`)
 */

const fs = require("fs")
const path = require("path")

const TARGET = path.join(
  __dirname,
  "..",
  ".medusa",
  "types",
  "query-entry-points.d.ts"
)

// Two-line anchor that is UNIQUE to the Product type.
// `metadata` followed immediately by `sales_channels_link` only appears in Product.
const ANCHOR_LINE_1 = "  metadata: Maybe<Scalars['JSON']['output']>;"
const ANCHOR_LINE_2 = "  sales_channels_link: Maybe<Array<Maybe<LinkProductSalesChannel>>>;"
const ANCHOR = ANCHOR_LINE_1 + "\n" + ANCHOR_LINE_2

const INJECTION = [
  "  /**",
  "   * Custom JSONB column added by Migration20260223000000.",
  "   * Re-apply after `medusa develop` regenerates this file: yarn patch:types",
  "   */",
  "  sports_attributes: Maybe<Scalars['JSON']['output']>;",
].join("\n")

if (!fs.existsSync(TARGET)) {
  console.error("patch-medusa-types: target not found:", TARGET)
  process.exit(1)
}

const original = fs.readFileSync(TARGET, "utf8")

// Idempotent: skip if already present.
if (original.includes("sports_attributes")) {
  console.log("patch-medusa-types: sports_attributes already present — skipped.")
  process.exit(0)
}

if (!original.includes(ANCHOR)) {
  console.error(
    "patch-medusa-types: anchor not found in target file.\n" +
    "The generated Product type may have changed layout.\n" +
    "Update ANCHOR_LINE_1 / ANCHOR_LINE_2 in scripts/patch-medusa-types.js to match."
  )
  process.exit(1)
}

// Insert INJECTION between the two anchor lines.
const patched = original.replace(
  ANCHOR,
  ANCHOR_LINE_1 + "\n" + INJECTION + "\n" + ANCHOR_LINE_2
)

fs.writeFileSync(TARGET, patched, "utf8")

// Verify the write took effect in the same process.
const verify = fs.readFileSync(TARGET, "utf8")
if (!verify.includes("sports_attributes")) {
  console.error("patch-medusa-types: write succeeded but verification failed — unexpected.")
  process.exit(1)
}

console.log("patch-medusa-types: sports_attributes injected into Product type.")
