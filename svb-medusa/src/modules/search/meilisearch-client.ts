const INDEX_NAME = "products"

function readEnvText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function getConfig(): { host: string; apiKey: string } | null {
  const host = readEnvText(process.env.MEILISEARCH_HOST)
  const apiKey = readEnvText(process.env.MEILISEARCH_MASTER_KEY)
  if (!host) {
    return null
  }
  return { host, apiKey }
}

async function meiliRequest(
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  path: string,
  body?: unknown
): Promise<unknown> {
  const config = getConfig()
  if (!config) {
    return null
  }

  const url = `${config.host}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Meilisearch ${method} ${path} failed (${res.status}): ${text}`)
  }

  return res.json()
}

export type SearchProduct = {
  id: string
  title: string
  description: string | null
  handle: string
  thumbnail: string | null
  collection_title: string | null
  status: string
  cheapest_price: number | null
  currency_code: string | null
  // Flattened sports_attributes fields — sa_ prefix avoids collisions.
  // Present only on products that have sports_attributes set.
  [key: string]: unknown
}

export async function upsertProductInIndex(product: SearchProduct): Promise<void> {
  if (!getConfig()) return
  await meiliRequest("POST", `/indexes/${INDEX_NAME}/documents?primaryKey=id`, [product])
}

export async function deleteProductFromIndex(productId: string): Promise<void> {
  if (!getConfig()) return
  await meiliRequest("DELETE", `/indexes/${INDEX_NAME}/documents/${productId}`)
}

export async function bulkUpsertProductsInIndex(products: SearchProduct[]): Promise<void> {
  if (!getConfig() || !products.length) return
  await meiliRequest("POST", `/indexes/${INDEX_NAME}/documents?primaryKey=id`, products)
}

// All sa_* fields that may appear in the index.
// Array fields (sa_skill_level, sa_age_group, etc.) are stored as JSON arrays
// in MeiliSearch and support multi-value filtering natively.
const SA_FILTERABLE = [
  // ── Top-level ──────────────────────────────────────────────────────────────
  "sa_sport",
  "sa_equipment_type",
  // ── Common (shared across all sports) ─────────────────────────────────────
  "sa_skill_level",
  "sa_age_group",
  "sa_activity_intensity",
  "sa_playing_surface",
  "sa_best_for",
  "sa_protection_level",
  // ── Cricket: Ball ──────────────────────────────────────────────────────────
  "sa_ball_type",
  "sa_ball_grade",
  "sa_ball_color",
  "sa_ball_size",
  "sa_seam_type",
  // ── Cricket: Bat ──────────────────────────────────────────────────────────
  "sa_wood_type",
  "sa_blade_grade",
  "sa_blade_profile",
  "sa_blade_edge",
  "sa_blade_spine",
  "sa_handle_type",
  "sa_handle_length",
  // ── Cricket: Gloves ───────────────────────────────────────────────────────
  "sa_glove_hand",
  "sa_palm_material",
  "sa_ventilation",
  "sa_wrist_closure",
  "sa_webbing_type",
  // ── Cricket: Pads ─────────────────────────────────────────────────────────
  "sa_pad_side",
  "sa_pad_material",
  "sa_knee_roll",
  "sa_straps_count",
  "sa_pad_style",
  // ── Cricket: Helmet ───────────────────────────────────────────────────────
  "sa_helmet_standard",
  "sa_grill_type",
  "sa_peak_type",
  // ── Shared: Body protection / Shin guards ─────────────────────────────────
  "sa_guard_type",
  "sa_material",
  "sa_gender",
  // ── Shared: Footwear ──────────────────────────────────────────────────────
  "sa_sole_type",
  "sa_upper_material",
  "sa_surface_type",
  "sa_closure_type",
  // ── Shared: Clothing ──────────────────────────────────────────────────────
  "sa_garment_type",
  "sa_fabric",
  "sa_fit_type",
  "sa_season",
  // ── Cricket: Bags ─────────────────────────────────────────────────────────
  "sa_bag_type",
  "sa_bag_material",
  // ── Cricket: Bat accessories ──────────────────────────────────────────────
  "sa_accessory_type",
  "sa_compatible_bat_size",
  // ── Cricket: Training equipment ───────────────────────────────────────────
  "sa_training_type",
  "sa_surface_compatibility",
  // ── Football ──────────────────────────────────────────────────────────────
  "sa_panel_type",
  "sa_bladder_type",
  "sa_stud_type",
  // ── Football / Basketball / Volleyball: Shoes / GK Gloves ─────────────────
  "sa_cut_type",
  "sa_cushioning",
  // ── Volleyball ────────────────────────────────────────────────────────────
  "sa_panel_count",
] as const

export async function configureSearchIndex(): Promise<void> {
  if (!getConfig()) return
  await meiliRequest("PATCH", `/indexes/${INDEX_NAME}/settings`, {
    searchableAttributes: [
      "title",
      "description",
      "collection_title",
      "sa_sport",
      "sa_equipment_type",
    ],
    filterableAttributes: ["status", "collection_title", ...SA_FILTERABLE],
    sortableAttributes: ["cheapest_price"],
    // "*" means display every stored attribute (including all future sa_* fields)
    displayedAttributes: ["*"],
  })
}
