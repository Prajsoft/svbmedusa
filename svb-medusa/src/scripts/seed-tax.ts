import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Seeds GST tax rates for the India region.
 *
 * Run: medusa exec ./src/scripts/seed-tax.ts
 *
 * Idempotent — skips creation if a default GST rate already exists on
 * the India tax region.
 *
 * GST rates used:
 *   - Default (catch-all): 12% — covers most sports equipment (HSN 9506)
 *   - Apparel / footwear:  5%  — add via admin for specific categories
 */
export default async function seedTaxData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const taxModuleService = container.resolve(Modules.TAX)

  logger.info("Fetching India tax region...")

  const taxRegions = await taxModuleService.listTaxRegions({
    country_code: "in",
  })

  if (!taxRegions.length) {
    logger.error(
      'No tax region found for "in". Run the main seed first: npm run seed'
    )
    return
  }

  const indiaTaxRegion = taxRegions[0]
  logger.info(`Found tax region: ${indiaTaxRegion.id}`)

  // Check if a default GST rate already exists
  const existingRates = await taxModuleService.listTaxRates({
    tax_region_id: indiaTaxRegion.id,
    is_default: true,
  })

  if (existingRates.length) {
    logger.info(
      `Default GST rate already exists (${existingRates[0].rate}%) — skipping.`
    )
    return
  }

  logger.info("Creating GST tax rates...")

  await taxModuleService.createTaxRates([
    {
      tax_region_id: indiaTaxRegion.id,
      name: "GST",
      rate: 12,
      is_default: true,
      metadata: {
        tax_type: "gst",
        components: "CGST 6% + SGST 6%",
        hsn_range: "9506",
        notes: "Default rate for sports goods. Override per product category in admin.",
      },
    },
  ])

  logger.info("GST rate seeded: 12% (CGST 6% + SGST 6%) — default for all products.")
  logger.info(
    "To add category-specific rates (e.g. 5% for apparel), use the Medusa admin."
  )
}
