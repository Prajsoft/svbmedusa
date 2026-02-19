import { createPromotionsWorkflow } from "@medusajs/core-flows"
import { CreatePromotionDTO, ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const PROMOTION_CODES = ["SVB10", "SVB100"] as const

const PROMOTION_SEEDS: CreatePromotionDTO[] = [
  {
    code: "SVB10",
    type: "standard",
    status: "active",
    is_automatic: false,
    application_method: {
      type: "percentage",
      target_type: "items",
      allocation: "across",
      value: 10,
    },
  },
  {
    code: "SVB100",
    type: "standard",
    status: "active",
    is_automatic: false,
    application_method: {
      type: "fixed",
      target_type: "items",
      allocation: "across",
      value: 100,
      currency_code: "inr",
    },
  },
]

type QueryLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown }>
}

type LoggerLike = {
  info: (message: string) => void
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

async function getExistingPromotionCodes(
  query: QueryLike,
  codes: readonly string[]
): Promise<Set<string>> {
  const { data } = await query.graph({
    entity: "promotion",
    fields: ["id", "code"],
    filters: {
      code: [...codes],
    },
  })

  const existingCodes = new Set<string>()
  const rows = Array.isArray(data) ? (data as Array<{ code?: string | null }>) : []

  for (const row of rows) {
    if (typeof row.code === "string" && row.code.trim()) {
      existingCodes.add(normalizeCode(row.code))
    }
  }

  return existingCodes
}

export default async function seedPromotions({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as LoggerLike
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike

  logger.info("Seeding promotions (SVB10, SVB100)...")

  const existingCodes = await getExistingPromotionCodes(query, PROMOTION_CODES)
  const promotionsToCreate = PROMOTION_SEEDS.filter(
    (promotion) => !existingCodes.has(normalizeCode(promotion.code))
  )

  if (!promotionsToCreate.length) {
    logger.info("Promotions already exist. Nothing to create.")
    return
  }

  const { result } = await createPromotionsWorkflow(container).run({
    input: {
      promotionsData: promotionsToCreate,
    },
  })

  const createdCodes =
    (Array.isArray(result) ? result : [])
      .map((promotion) =>
        typeof promotion?.code === "string" ? normalizeCode(promotion.code) : ""
      )
      .filter(Boolean)
      .join(", ") || "(none)"

  logger.info(`Created promotion(s): ${createdCodes}`)
}
