/**
 * Admin API integration tests — /admin/products/:id/sports-attributes
 *
 * Requires:
 *   TEST_ADMIN_EMAIL    — admin user email (used to fetch a fresh JWT each run)
 *   TEST_ADMIN_PASSWORD — admin user password
 *   TEST_PRODUCT_ID     — id of an existing product in the test database
 *   MEDUSA_BACKEND_URL  (optional, default: http://localhost:9000)
 *
 * All tests are skipped when credentials or TEST_PRODUCT_ID are not set.
 */

import request from "supertest"
import { Pool } from "pg"

const BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD
const PRODUCT_ID = process.env.TEST_PRODUCT_ID
const DB_URL = process.env.DATABASE_URL

const hasRequiredEnv = !!ADMIN_EMAIL && !!ADMIN_PASSWORD && !!PRODUCT_ID

const suite = hasRequiredEnv ? describe : describe.skip

// A complete valid SportsAttributes payload used across tests.
const VALID_PAYLOAD = {
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
    overs_durability: "50+ overs",
  },
}

suite(
  "Admin API — /admin/products/:id/sports-attributes [requires TEST_ADMIN_EMAIL + TEST_PRODUCT_ID]",
  () => {
    let pool: Pool | null = null
    let token = ""

    beforeAll(async () => {
      // Fetch a fresh JWT (static tokens expire after 1 hour)
      const authRes = await request(BACKEND_URL)
        .post("/auth/user/emailpass")
        .send({ email: ADMIN_EMAIL!, password: ADMIN_PASSWORD! })
      if (!authRes.body.token) {
        throw new Error(`Failed to obtain admin token: ${JSON.stringify(authRes.body)}`)
      }
      token = authRes.body.token

      // Reset sports_attributes to NULL before the test suite runs so Test 1
      // can reliably verify the null state, even if a previous run left data.
      if (DB_URL && PRODUCT_ID) {
        pool = new Pool({ connectionString: DB_URL })
        await pool.query(
          `UPDATE product SET sports_attributes = NULL WHERE id = $1`,
          [PRODUCT_ID]
        )
      }
    })

    afterAll(async () => {
      if (pool) await pool.end()
    })

    // ── Test 1 — GET returns null for fresh product ─────────────────────────
    it("GET returns 200 with sports_attributes: null for a product with no data", async () => {
      const res = await request(BACKEND_URL)
        .get(`/admin/products/${PRODUCT_ID!}/sports-attributes`)
        .set("Authorization", `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("sports_attributes", null)
    })

    // ── Test 2 — POST saves valid data ──────────────────────────────────────
    it("POST saves a valid SportsAttributes payload and returns success", async () => {
      const res = await request(BACKEND_URL)
        .post(`/admin/products/${PRODUCT_ID!}/sports-attributes`)
        .set("Authorization", `Bearer ${token}`)
        .send(VALID_PAYLOAD)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.sports_attributes).toMatchObject(VALID_PAYLOAD)
    })

    // ── Test 3 — GET returns saved data after POST ──────────────────────────
    it("GET returns the data that was saved in the previous POST", async () => {
      const res = await request(BACKEND_URL)
        .get(`/admin/products/${PRODUCT_ID!}/sports-attributes`)
        .set("Authorization", `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.sports_attributes).toMatchObject(VALID_PAYLOAD)
    })

    // ── Test 4 — Invalid skill_level ────────────────────────────────────────
    it("POST returns 400 when skill_level contains an invalid value", async () => {
      const badPayload = {
        ...VALID_PAYLOAD,
        common: { ...VALID_PAYLOAD.common, skill_level: ["Expert"] },
      }

      const res = await request(BACKEND_URL)
        .post(`/admin/products/${PRODUCT_ID!}/sports-attributes`)
        .set("Authorization", `Bearer ${token}`)
        .send(badPayload)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe("Validation failed")
      // The error key is the literal string "common.skill_level" (dot in the key name),
      // so use bracket notation instead of toHaveProperty which traverses nested paths.
      expect(res.body.details["common.skill_level"]).toBeDefined()
    })

    // ── Test 5 — Invalid activity_intensity ────────────────────────────────
    it("POST returns 400 when activity_intensity is not a known value", async () => {
      const badPayload = {
        ...VALID_PAYLOAD,
        common: { ...VALID_PAYLOAD.common, activity_intensity: "Extreme" },
      }

      const res = await request(BACKEND_URL)
        .post(`/admin/products/${PRODUCT_ID!}/sports-attributes`)
        .set("Authorization", `Bearer ${token}`)
        .send(badPayload)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe("Validation failed")
      expect(res.body.details["common.activity_intensity"]).toBeDefined()
    })

    // ── Test 6 — certification exceeds max length ───────────────────────────
    it("POST returns 400 when certification exceeds 500 characters", async () => {
      const badPayload = {
        ...VALID_PAYLOAD,
        common: {
          ...VALID_PAYLOAD.common,
          certification: "A".repeat(501),
        },
      }

      const res = await request(BACKEND_URL)
        .post(`/admin/products/${PRODUCT_ID!}/sports-attributes`)
        .set("Authorization", `Bearer ${token}`)
        .send(badPayload)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe("Validation failed")
      expect(res.body.details["common.certification"]).toBeDefined()
    })

    // ── Test 7 — ball_color exceeds 10 items ───────────────────────────────
    it("POST returns 400 when ball_color array has more than 10 items", async () => {
      const badPayload = {
        ...VALID_PAYLOAD,
        sport_specific: {
          ...VALID_PAYLOAD.sport_specific,
          ball_color: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11"],
        },
      }

      const res = await request(BACKEND_URL)
        .post(`/admin/products/${PRODUCT_ID!}/sports-attributes`)
        .set("Authorization", `Bearer ${token}`)
        .send(badPayload)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe("Validation failed")
      expect(res.body.details["sport_specific.ball_color"]).toBeDefined()
    })

    // ── Test 8 — Non-existent product returns 404 ───────────────────────────
    it("POST returns 404 for a product id that does not exist", async () => {
      const res = await request(BACKEND_URL)
        .post(`/admin/products/fake_id_does_not_exist_999/sports-attributes`)
        .set("Authorization", `Bearer ${token}`)
        .send(VALID_PAYLOAD)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe("Product not found")
    })

    // ── Test 9 — GET without auth returns 401 ──────────────────────────────
    it("GET returns 401 when no Authorization header is provided", async () => {
      const res = await request(BACKEND_URL)
        .get(`/admin/products/${PRODUCT_ID!}/sports-attributes`)

      expect(res.status).toBe(401)
    })

    // ── Test 10 — POST without auth returns 401 ─────────────────────────────
    it("POST returns 401 when no Authorization header is provided", async () => {
      const res = await request(BACKEND_URL)
        .post(`/admin/products/${PRODUCT_ID!}/sports-attributes`)
        .send(VALID_PAYLOAD)

      expect(res.status).toBe(401)
    })
  }
)
