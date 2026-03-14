/**
 * Migration tests — sports_attributes column on the product table.
 *
 * Requires a live PostgreSQL connection via DATABASE_URL.
 * All tests are skipped when DATABASE_URL is not set.
 */

import { Pool } from "pg"

const DB_URL = process.env.DATABASE_URL
const hasDb = !!DB_URL

// Conditional describe: all tests skipped when DATABASE_URL is not set.
const suite = hasDb ? describe : describe.skip

suite(
  "Migration — sports_attributes column and GIN index [requires DATABASE_URL]",
  () => {
    let pool: Pool
    let canConnect = false

    beforeAll(async () => {
      pool = new Pool({
        connectionString: DB_URL,
        connectionTimeoutMillis: 3000,
      })
      try {
        await pool.query("SELECT 1")
        canConnect = true
      } catch {
        console.warn(
          "\n[migration.test] Skipping DB tests — cannot connect to",
          DB_URL,
          "\nStart the SSH tunnel: ssh -L 5432:localhost:5432 root@<server> -N"
        )
      }
    })

    afterAll(async () => {
      await pool.end()
    })

    /** Skip gracefully when DB is unreachable (e.g. SSH tunnel is down). */
    function guardDb(): boolean {
      if (!canConnect) {
        console.warn("[migration.test] test skipped — DB not reachable")
        return false
      }
      return true
    }

    // ── Test 1 — Column exists ──────────────────────────────────────────────
    it("column sports_attributes exists on product table with correct definition", async () => {
      if (!guardDb()) return
      const { rows } = await pool.query<{
        column_name: string
        data_type: string
        is_nullable: string
      }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = $1
           AND column_name = $2`,
        ["product", "sports_attributes"]
      )

      expect(rows).toHaveLength(1)
      expect(rows[0].column_name).toBe("sports_attributes")
      expect(rows[0].data_type).toBe("jsonb")
      expect(rows[0].is_nullable).toBe("YES")
    })

    // ── Test 2 — GIN index exists ───────────────────────────────────────────
    it("GIN index IDX_product_sports_attributes exists with jsonb_path_ops", async () => {
      if (!guardDb()) return
      const { rows } = await pool.query<{
        indexname: string
        indexdef: string
      }>(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE tablename = $1
           AND indexname = $2`,
        ["product", "IDX_product_sports_attributes"]
      )

      expect(rows).toHaveLength(1)
      expect(rows[0].indexname).toBe("IDX_product_sports_attributes")
      expect(rows[0].indexdef).toContain("jsonb_path_ops")
    })

    // ── Test 3 — Column accepts valid jsonb ─────────────────────────────────
    it("column accepts valid jsonb and round-trips correctly", async () => {
      if (!guardDb()) return
      // Insert a minimal test product so we can write sports_attributes.
      // We use a fixed test_id that is unlikely to conflict with real products.
      const testId = "test-migration-sports-attr-001"
      const testPayload = {
        sport: "Cricket",
        common: {
          skill_level: ["Beginner"],
          age_group: ["Adult"],
          activity_intensity: "Training",
          playing_surface: ["Grass"],
          certification: "Test cert",
          best_for: "School",
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

      // Clean up before inserting (idempotent)
      await pool.query(`DELETE FROM product WHERE id = $1`, [testId])

      // Insert a bare-minimum product row (only required NOT NULL columns)
      await pool.query(
        `INSERT INTO product (id, title, handle, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [testId, "Test Migration Product", testId, "draft"]
      )

      // Write sports_attributes
      await pool.query(
        `UPDATE product SET sports_attributes = $1::jsonb WHERE id = $2`,
        [JSON.stringify(testPayload), testId]
      )

      // Read back
      const { rows } = await pool.query<{ sports_attributes: unknown }>(
        `SELECT sports_attributes FROM product WHERE id = $1`,
        [testId]
      )

      expect(rows).toHaveLength(1)
      expect(rows[0].sports_attributes).toEqual(testPayload)

      // Cleanup
      await pool.query(`DELETE FROM product WHERE id = $1`, [testId])
    })

    // ── Test 4 — Column accepts null ────────────────────────────────────────
    it("column accepts NULL without constraint violation", async () => {
      if (!guardDb()) return
      const testId = "test-migration-sports-attr-null-001"

      await pool.query(`DELETE FROM product WHERE id = $1`, [testId])

      // Insert with sports_attributes explicitly NULL
      await pool.query(
        `INSERT INTO product (id, title, handle, status, sports_attributes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, NOW(), NOW())`,
        [testId, "Test Null Product", testId, "draft"]
      )

      const { rows } = await pool.query<{ sports_attributes: unknown }>(
        `SELECT sports_attributes FROM product WHERE id = $1`,
        [testId]
      )

      expect(rows).toHaveLength(1)
      expect(rows[0].sports_attributes).toBeNull()

      // Cleanup
      await pool.query(`DELETE FROM product WHERE id = $1`, [testId])
    })
  }
)
