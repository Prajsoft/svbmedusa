/**
 * Store filter route integration tests — GET /store/products/sports-filter
 *
 * Requires:
 *   TEST_PRODUCT_ID   — id of a product that has sports_attributes saved
 *   MEDUSA_BACKEND_URL (optional, default: http://localhost:9000)
 *
 * These tests depend on at least one product in the database having
 * sports_attributes set (e.g. by the admin API tests running first, or by
 * the test's own beforeAll seeding step below).
 *
 * All tests are skipped when TEST_PRODUCT_ID is not set.
 */

import request from "supertest"
import { Pool } from "pg"

const BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const PRODUCT_ID = process.env.TEST_PRODUCT_ID
const PUB_KEY = process.env.TEST_PUBLISHABLE_KEY
const DB_URL = process.env.DATABASE_URL

// Medusa v2 store routes require x-publishable-api-key
const hasRequiredEnv = !!PRODUCT_ID && !!PUB_KEY

const suite = hasRequiredEnv ? describe : describe.skip

// The sports_attributes value we seed before these tests run.
// Must match the VALID_PAYLOAD saved by the admin API tests so both suites agree.
const SEED_PAYLOAD = {
  sport: "Cricket",
  common: {
    skill_level: ["Beginner", "Intermediate"],
    age_group: ["Adult"],
    activity_intensity: "Training",
    playing_surface: ["Grass", "Outdoor"],
    certification: "SG Approved",
    best_for: "Club",
    in_box_includes: "Ball, Pouch",
    customization_available: false,
    protection_level: "Standard",
  },
  sport_specific: {
    equipment_type: "Ball",
    ball_type: "Leather",
    ball_grade: "Match",
    seam_type: "Hand Stitched",
    ball_color: ["Red", "White"],
    ball_size: "Size 5 (Standard)",
    overs_durability: "60-80",
  },
}

suite(
  "Store filter — GET /store/products/sports-filter [requires TEST_PRODUCT_ID]",
  () => {
    let pool: Pool | null = null

    beforeAll(async () => {
      // Ensure the test product has sports_attributes set via direct DB write.
      // This makes the tests self-contained regardless of whether the admin
      // API tests ran first.
      if (DB_URL && PRODUCT_ID) {
        pool = new Pool({ connectionString: DB_URL })
        await pool.query(
          `UPDATE product SET sports_attributes = $1::jsonb WHERE id = $2`,
          [JSON.stringify(SEED_PAYLOAD), PRODUCT_ID]
        )
      }
    })

    afterAll(async () => {
      if (pool) await pool.end()
    })

    // ── Test 1 — No params returns all sports products ──────────────────────
    it("returns 200 with products array when no filters supplied", async () => {
      const res = await request(BACKEND_URL)
        .get("/store/products/sports-filter")
        .set("x-publishable-api-key", PUB_KEY!)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("products")
      expect(res.body).toHaveProperty("count")
      expect(res.body).toHaveProperty("limit", 20)
      expect(res.body).toHaveProperty("offset", 0)
      expect(Array.isArray(res.body.products)).toBe(true)
      expect(res.body.count).toBeGreaterThan(0)

      // Every returned product must have sports_attributes set
      for (const p of res.body.products as { sports_attributes: unknown }[]) {
        expect(p.sports_attributes).not.toBeNull()
      }
    })

    // ── Test 2 — Filter by ball_type ────────────────────────────────────────
    it("filters by ball_type and returns only matching products", async () => {
      const res = await request(BACKEND_URL)
        .get("/store/products/sports-filter")
        .set("x-publishable-api-key", PUB_KEY!)
        .query({ ball_type: "Leather" })

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.products)).toBe(true)

      for (const p of res.body.products as { sports_attributes: { sport_specific: { ball_type: string } } }[]) {
        expect(p.sports_attributes.sport_specific.ball_type).toBe("Leather")
      }
    })

    // ── Test 3 — Multiple filters use AND logic ─────────────────────────────
    it("applies multiple filters with AND logic", async () => {
      const res = await request(BACKEND_URL)
        .get("/store/products/sports-filter")
        .set("x-publishable-api-key", PUB_KEY!)
        .query({ ball_type: "Leather", ball_grade: "Match" })

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.products)).toBe(true)

      for (const p of res.body.products as {
        sports_attributes: { sport_specific: { ball_type: string; ball_grade: string } }
      }[]) {
        expect(p.sports_attributes.sport_specific.ball_type).toBe("Leather")
        expect(p.sports_attributes.sport_specific.ball_grade).toBe("Match")
      }
    })

    // ── Test 4 — Array field filter (skill_level) ───────────────────────────
    it("filters by skill_level array field using containment", async () => {
      const res = await request(BACKEND_URL)
        .get("/store/products/sports-filter")
        .set("x-publishable-api-key", PUB_KEY!)
        .query({ skill_level: "Beginner" })

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.products)).toBe(true)

      for (const p of res.body.products as {
        sports_attributes: { common: { skill_level: string[] } }
      }[]) {
        expect(p.sports_attributes.common.skill_level).toContain("Beginner")
      }
    })

    // ── Test 5 — Non-matching filter returns empty results ──────────────────
    it("returns empty products array (not 404/500) when no products match the filter", async () => {
      const res = await request(BACKEND_URL)
        .get("/store/products/sports-filter")
        .set("x-publishable-api-key", PUB_KEY!)
        .query({ ball_type: "NonExistentBallType_XYZ_999" })

      expect(res.status).toBe(200)
      expect(res.body.products).toEqual([])
      expect(res.body.count).toBe(0)
    })

    // ── Test 6 — Pagination limit and offset ────────────────────────────────
    it("respects limit and offset pagination parameters", async () => {
      const res = await request(BACKEND_URL)
        .get("/store/products/sports-filter")
        .set("x-publishable-api-key", PUB_KEY!)
        .query({ limit: "1", offset: "0" })

      expect(res.status).toBe(200)
      expect(res.body.products.length).toBeLessThanOrEqual(1)
      expect(res.body.limit).toBe(1)
      expect(res.body.offset).toBe(0)
    })

    // ── Test 7 — limit capped at 100 ────────────────────────────────────────
    it("caps limit at 100 even when a larger value is requested", async () => {
      const res = await request(BACKEND_URL)
        .get("/store/products/sports-filter")
        .set("x-publishable-api-key", PUB_KEY!)
        .query({ limit: "999" })

      expect(res.status).toBe(200)
      expect(res.body.limit).toBe(100)
    })

    // ── Test 8 — Invalid limit falls back to default ─────────────────────────
    it("falls back to default limit of 20 for a non-numeric limit param", async () => {
      const res = await request(BACKEND_URL)
        .get("/store/products/sports-filter")
        .set("x-publishable-api-key", PUB_KEY!)
        .query({ limit: "abc" })

      expect(res.status).toBe(200)
      expect(res.body.limit).toBe(20)
    })
  }
)
