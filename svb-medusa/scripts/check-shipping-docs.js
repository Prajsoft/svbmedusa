const fs = require("fs")
const path = require("path")

const REQUIRED_DOC_PATTERNS = [
  {
    file: "docs/shipping/providers/shiprocket.md",
    patterns: [
      /SHIPROCKET_SELLER_EMAIL/,
      /SHIPROCKET_SELLER_PASSWORD/,
      /SHIPROCKET_WEBHOOK_TOKEN/,
      /SHIPROCKET_BASE_URL/,
      /SHIPPING_BOOKING_ENABLED/,
      /ALLOW_UNSIGNED_WEBHOOKS/,
      /anx-api-key/i,
      /\/webhooks\/shipping\/shiprocket/,
      /forward-shipment/i,
      /multi-account/i,
      /seller_id/i,
    ],
  },
  {
    file: "docs/shipping/qa-runbook.md",
    patterns: [
      /quote two-step/i,
      /booking disabled/i,
      /booking enabled/i,
      /out-of-order/i,
      /label expiry/i,
      /cancel idempotency/i,
    ],
  },
]

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}

function runShippingDocsCheck(rootDir = process.cwd()) {
  const missing = []

  for (const check of REQUIRED_DOC_PATTERNS) {
    const absolutePath = path.join(rootDir, check.file)
    const content = readFileSafe(absolutePath)
    if (content === null) {
      missing.push(`${check.file}: file missing`)
      continue
    }

    for (const pattern of check.patterns) {
      if (!pattern.test(content)) {
        missing.push(`${check.file}: missing pattern ${pattern}`)
      }
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  }
}

function runAsCli() {
  const result = runShippingDocsCheck(process.cwd())
  if (!result.ok) {
    console.error("Shipping docs check failed.")
    for (const entry of result.missing) {
      console.error(`- ${entry}`)
    }
    process.exit(1)
  }

  console.log("Shipping docs check passed.")
}

if (require.main === module) {
  runAsCli()
}

module.exports = {
  REQUIRED_DOC_PATTERNS,
  runShippingDocsCheck,
}

