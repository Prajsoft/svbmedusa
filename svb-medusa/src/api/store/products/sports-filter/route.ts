import type { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { toApiErrorResponse } from "../../../../modules/observability/errors"

// ── Sanitize ──────────────────────────────────────────────────────────────────
// Strip everything except alphanumeric chars, spaces, hyphens, parentheses and
// commas.  Commas are needed for free-text fields like `in_box_includes` that
// are stored as comma-separated strings (e.g. "Ball, Kit Bag").
// This prevents any SQL/JSON injection from query param values.
function sanitize(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.replace(/[^a-zA-Z0-9 \-(),]/g, "").trim()
}

// Parse a boolean from a query-param string ("true"/"1" → true, "false"/"0" → false).
// Returns null when the param is absent or unrecognisable so callers can skip it.
function parseBool(value: unknown): boolean | null {
  if (value === "true"  || value === "1") return true
  if (value === "false" || value === "0") return false
  return null
}

// ── Pagination helpers ────────────────────────────────────────────────────────
function parseLimit(value: unknown): number {
  const n = parseInt(String(value), 10)
  if (!Number.isFinite(n) || n < 1) return 20
  return Math.min(n, 100)
}

function parseOffset(value: unknown): number {
  const n = parseInt(String(value), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

// ── GET /store/products/sports-filter ────────────────────────────────────────

export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  try {
    const q = req.query as Record<string, unknown>
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    // Scope queries to the sales channels associated with this publishable API key.
    // Prevents products that are published but not linked to the storefront's channel
    // from appearing in sport-pill counts or search results.
    const salesChannelIds = req.publishable_key_context.sales_channel_ids

    // Mutates and returns the query builder — safe because Knex builders are fluent.
    function withSalesChannelScope<T>(query: T): T {
      if (salesChannelIds.length === 0) return query
      return (query as any).whereExists(
        pgConnection("product_sales_channel")
          .select(pgConnection.raw("1"))
          .whereRaw('"product_sales_channel"."product_id" = "product"."id"')
          .whereIn("sales_channel_id", salesChannelIds)
      ) as T
    }

    // ── Distinct sports shortcut ────────────────────────────────────────────
    // ?distinct_sports=1 returns the sorted list of sport values that have at
    // least one published product in the current sales channel.  Used by the
    // storefront's sport-pill filter to avoid a full catalog scan.
    if (q.distinct_sports === "1") {
      const rows = await withSalesChannelScope(
        pgConnection("product")
          .whereNull("deleted_at")
          .where("status", "published")
          .whereNotNull("sports_attributes")
          .whereRaw("sports_attributes->>'sport' IS NOT NULL")
          .select(pgConnection.raw("DISTINCT sports_attributes->>'sport' as sport"))
      )
      const sports = rows
        .map((r: { sport: string }) => r.sport)
        .filter(Boolean)
        .sort()
      return res.status(200).json({ sports })
    }

    // ── Pagination ─────────────────────────────────────────────────────────
    const limit = parseLimit(q.limit)
    const offset = parseOffset(q.offset)

    // ── Sanitize filter params ─────────────────────────────────────────────
    const sport = sanitize(q.sport)
    const skill_level = sanitize(q.skill_level)
    const age_group = sanitize(q.age_group)
    const activity_intensity = sanitize(q.activity_intensity)
    const playing_surface = sanitize(q.playing_surface)
    const certification = sanitize(q.certification)
    const best_for = sanitize(q.best_for)
    const in_box_includes = sanitize(q.in_box_includes)
    const protection_level = sanitize(q.protection_level)
    const customization_available = parseBool(q.customization_available)
    const equipment_type = sanitize(q.equipment_type)
    const ball_type = sanitize(q.ball_type)
    const ball_grade = sanitize(q.ball_grade)
    const ball_color = sanitize(q.ball_color)
    const ball_size = sanitize(q.ball_size)
    const overs_durability = sanitize(q.overs_durability)
    const product_handle = sanitize(q.handle)

    // ── Build containment JSON ─────────────────────────────────────────────
    // We merge all active filter conditions into one @> containment object.
    // Array fields are wrapped in an array so @> checks "array contains value".
    // String fields are matched directly.
    const containment: Record<string, unknown> = {}
    const common: Record<string, unknown> = {}
    const sportSpecific: Record<string, unknown> = {}

    // Top-level fields
    if (sport) containment.sport = sport

    // Common — array fields (wrap value in array for @> containment)
    if (skill_level) common.skill_level = [skill_level]
    if (age_group) common.age_group = [age_group]
    if (playing_surface) common.playing_surface = [playing_surface]

    // Common — string fields
    if (activity_intensity) common.activity_intensity = activity_intensity
    if (certification) common.certification = certification
    if (best_for) common.best_for = best_for
    if (in_box_includes) common.in_box_includes = in_box_includes
    if (protection_level) common.protection_level = protection_level
    // Common — boolean field (null means "not provided", skip it)
    if (customization_available !== null) common.customization_available = customization_available

    // Sport-specific — string fields
    if (equipment_type) sportSpecific.equipment_type = equipment_type
    if (ball_type) sportSpecific.ball_type = ball_type
    if (ball_grade) sportSpecific.ball_grade = ball_grade
    if (ball_size) sportSpecific.ball_size = ball_size
    if (overs_durability) sportSpecific.overs_durability = overs_durability

    // Sport-specific — array fields (wrap value in array for @> containment)
    if (ball_color) sportSpecific.ball_color = [ball_color]

    // Attach nested objects only if they have at least one condition
    if (Object.keys(common).length > 0) containment.common = common
    if (Object.keys(sportSpecific).length > 0) containment.sport_specific = sportSpecific

    const hasFilters = Object.keys(containment).length > 0

    // ── Query ──────────────────────────────────────────────────────────────
    let baseQuery = withSalesChannelScope(
      pgConnection("product")
        .whereNull("deleted_at")
        .where("status", "published")
        .select("id", "title", "handle", "thumbnail", "sports_attributes")
    )

    if (hasFilters) {
      // Parameterised @> containment — user input never concatenated into SQL
      baseQuery = baseQuery.whereRaw(
        "sports_attributes @> ?::jsonb",
        [JSON.stringify(containment)]
      )
    } else {
      // No filters — return all products that have sports_attributes set
      baseQuery = baseQuery.whereNotNull("sports_attributes")
    }

    // Narrow by specific handle when requested (e.g. from the PDP)
    if (product_handle) {
      baseQuery = baseQuery.where("handle", product_handle)
    }

    // Count total matching rows (before pagination)
    const countQuery = withSalesChannelScope(
      pgConnection("product")
        .whereNull("deleted_at")
        .where("status", "published")
        .whereNotNull("sports_attributes")
    )

    if (hasFilters) {
      countQuery.whereRaw(
        "sports_attributes @> ?::jsonb",
        [JSON.stringify(containment)]
      )
    }

    if (product_handle) {
      countQuery.where("handle", product_handle)
    }

    const [rows, [{ count: totalCount }]] = await Promise.all([
      baseQuery.limit(limit).offset(offset),
      countQuery.count("id as count"),
    ])

    res.status(200).json({
      products: rows,
      count: Number(totalCount),
      limit,
      offset,
    })
  } catch (error) {
    const mapped = toApiErrorResponse(error)
    res.status(mapped.status).json(mapped.body)
  }
}
