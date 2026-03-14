/**
 * Admin API integration tests — POST /admin/products/sports-attributes/batch
 *
 * Requires:
 *   TEST_ADMIN_EMAIL    — admin user email
 *   TEST_ADMIN_PASSWORD — admin user password
 *   TEST_PRODUCT_ID     — id of an existing product in the test database
 *   TEST_PRODUCT_ID_2   — id of a second existing product (optional; batch tests
 *                         that need two products are skipped when absent)
 *   MEDUSA_BACKEND_URL  (optional, default: http://localhost:9000)
 *
 * All tests are skipped when credentials or TEST_PRODUCT_ID are not set.
 */

import request from "supertest"
import { Pool } from "pg"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD
const PRODUCT_ID = process.env.TEST_PRODUCT_ID
const PRODUCT_ID_2 = process.env.TEST_PRODUCT_ID_2 ?? null
const DB_URL = process.env.DATABASE_URL

const BATCH_URL = "/admin/products/sports-attributes/batch"

const hasRequiredEnv = !!ADMIN_EMAIL && !!ADMIN_PASSWORD && !!PRODUCT_ID

const suite = hasRequiredEnv ? describe : describe.skip

// A complete valid SportsAttributes payload used across tests.
const VALID_ATTRS = {
  sport: "Cricket",
  common: {
    skill_level: ["Beginner"],
    age_group: ["Adult"],
    activity_intensity: "Training",
    playing_surface: ["Outdoor"],
    certification: "SG Approved",
    best_for: "Club",
    in_box_includes: "Ball",
    customization_available: false,
    protection_level: "Standard",
  },
  sport_specific: {
    equipment_type: "Ball",
    ball_type: "Leather",
    ball_grade: "Match",
    seam_type: "Hand Stitched",
    ball_color: ["Red"],
    ball_size: "Size 5 (Standard)",
    overs_durability: "60-80",
  },
}

suite(
  "Admin API — POST /admin/products/sports-attributes/batch [requires TEST_ADMIN_EMAIL + TEST_PRODUCT_ID]",
  () => {
    let pool: Pool | null = null
    let token = ""

    beforeAll(async () => {
      // Fetch a fresh JWT
      const authRes = await request(BACKEND_URL)
        .post("/auth/user/emailpass")
        .send({ email: ADMIN_EMAIL!, password: ADMIN_PASSWORD! })
      if (!authRes.body.token) {
        throw new Error(
          `Failed to obtain admin token: ${JSON.stringify(authRes.body)}`
        )
      }
      token = authRes.body.token

      // Reset sports_attributes to NULL before the suite runs
      if (DB_URL && PRODUCT_ID) {
        pool = new Pool({ connectionString: DB_URL })
        const ids = [PRODUCT_ID, PRODUCT_ID_2].filter(Boolean) as string[]
        await pool.query(
          `UPDATE product SET sports_attributes = NULL WHERE id = ANY($1::text[])`,
          [ids]
        )
      }
    })

    afterAll(async () => {
      if (pool) await pool.end()
    })

    // ── Test 1 — Valid single-item batch ─────────────────────────────────────
    it("returns 200 with updated=1 for a valid single-item batch", async () => {
      const res = await request(BACKEND_URL)
        .post(BATCH_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({
          updates: [
            { product_id: PRODUCT_ID!, sports_attributes: VALID_ATTRS },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.updated).toBe(1)
      expect(res.body.not_found).toEqual([])
    })

    // ── Test 2 — Data persisted after batch write ─────────────────────────────
    it("data written by the batch is readable via the single-product GET", async () => {
      const res = await request(BACKEND_URL)
        .get(`/admin/products/${PRODUCT_ID!}/sports-attributes`)
        .set("Authorization", `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.sports_attributes).toMatchObject(VALID_ATTRS)
    })

    // ── Test 3 — Multi-product batch (skipped if PRODUCT_ID_2 missing) ────────
    const twoProductSuite = PRODUCT_ID_2 ? it : it.skip

    twoProductSuite(
      "returns 200 with updated=2 when two valid products are in the batch",
      async () => {
        const res = await request(BACKEND_URL)
          .post(BATCH_URL)
          .set("Authorization", `Bearer ${token}`)
          .send({
            updates: [
              { product_id: PRODUCT_ID!, sports_attributes: VALID_ATTRS },
              { product_id: PRODUCT_ID_2!, sports_attributes: VALID_ATTRS },
            ],
          })

        expect(res.status).toBe(200)
        expect(res.body.updated).toBe(2)
        expect(res.body.not_found).toEqual([])
      }
    )

    // ── Test 4 — Non-existent product_id ends up in not_found ─────────────────
    it("returns 200 with the phantom id in not_found when a product does not exist", async () => {
      const fakeId = "prod_does_not_exist_000"
      const res = await request(BACKEND_URL)
        .post(BATCH_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({
          updates: [
            { product_id: PRODUCT_ID!, sports_attributes: VALID_ATTRS },
            { product_id: fakeId, sports_attributes: VALID_ATTRS },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.updated).toBe(1)
      expect(res.body.not_found).toContain(fakeId)
    })

    // ── Test 5 — All products non-existent ────────────────────────────────────
    it("returns 200 with updated=0 when no product_ids exist", async () => {
      const res = await request(BACKEND_URL)
        .post(BATCH_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({
          updates: [
            { product_id: "fake_1", sports_attributes: VALID_ATTRS },
            { product_id: "fake_2", sports_attributes: VALID_ATTRS },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.updated).toBe(0)
      expect(res.body.not_found).toEqual(["fake_1", "fake_2"])
    })

    // ── Test 6 — Empty updates array ─────────────────────────────────────────
    it("returns 400 when updates is an empty array", async () => {
      const res = await request(BACKEND_URL)
        .post(BATCH_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ updates: [] })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/empty/)
    })

    // ── Test 7 — Missing updates field ───────────────────────────────────────
    it("returns 400 when updates field is absent", async () => {
      const res = await request(BACKEND_URL)
        .post(BATCH_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/updates/)
    })

    // ── Test 8 — Batch size exceeds limit ────────────────────────────────────
    it("returns 400 when batch size exceeds 200", async () => {
      const oversized = Array.from({ length: 201 }, (_, i) => ({
        product_id: `fake_${i}`,
        sports_attributes: VALID_ATTRS,
      }))

      const res = await request(BACKEND_URL)
        .post(BATCH_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({ updates: oversized })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/maximum/)
    })

    // ── Test 9 — Per-item validation failure ─────────────────────────────────
    it("returns 400 with item_errors keyed by index when an item fails validation", async () => {
      const badAttrs = {
        ...VALID_ATTRS,
        common: {
          ...VALID_ATTRS.common,
          skill_level: ["Expert"], // invalid value
        },
      }

      const res = await request(BACKEND_URL)
        .post(BATCH_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({
          updates: [
            { product_id: PRODUCT_ID!, sports_attributes: VALID_ATTRS },
            { product_id: PRODUCT_ID!, sports_attributes: badAttrs }, // index 1 fails
          ],
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe("Validation failed")
      expect(res.body.item_errors["1"]).toBeDefined()
      expect(res.body.item_errors["1"]["common.skill_level"]).toBeDefined()
      // Index 0 is valid — should not appear in item_errors
      expect(res.body.item_errors["0"]).toBeUndefined()
    })

    // ── Test 10 — Missing product_id ─────────────────────────────────────────
    it("returns 400 when an item has no product_id", async () => {
      const res = await request(BACKEND_URL)
        .post(BATCH_URL)
        .set("Authorization", `Bearer ${token}`)
        .send({
          updates: [
            { sports_attributes: VALID_ATTRS }, // product_id missing
          ],
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe("Validation failed")
      expect(res.body.item_errors["0"]["product_id"]).toBeDefined()
    })

    // ── Test 11 — Unauthenticated request returns 401 ─────────────────────────
    it("returns 401 when no Authorization header is provided", async () => {
      const res = await request(BACKEND_URL)
        .post(BATCH_URL)
        .send({
          updates: [
            { product_id: PRODUCT_ID!, sports_attributes: VALID_ATTRS },
          ],
        })

      expect(res.status).toBe(401)
    })
  }
)
