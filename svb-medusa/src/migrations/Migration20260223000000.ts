import { Migration } from "@mikro-orm/migrations"

/**
 * Adds the `sports_attributes` JSONB column and a GIN index to the `product`
 * table.
 *
 * Why raw SQL and not an entity change?
 *   `product` is owned by @medusajs/product, so we cannot add properties to
 *   its MikroORM entity directly.  A raw-SQL migration is the correct approach
 *   for extending Medusa core tables with custom columns.
 *
 * Both statements use IF NOT EXISTS so the migration is safe to run against a
 * database that already has the column/index (e.g. production, where the
 * column was added manually before this file was created).
 */
export class Migration20260223000000 extends Migration {
  async up(): Promise<void> {
    // 1. Add the JSONB column (nullable — products start with no sports data)
    this.addSql(
      `ALTER TABLE "product"
       ADD COLUMN IF NOT EXISTS "sports_attributes" JSONB NULL;`
    )

    // 2. GIN index with jsonb_path_ops for fast @> containment queries used
    //    by the /store/products/sports-filter endpoint.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_product_sports_attributes"
       ON "product" USING gin ("sports_attributes" jsonb_path_ops);`
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `DROP INDEX IF EXISTS "IDX_product_sports_attributes";`
    )

    this.addSql(
      `ALTER TABLE "product"
       DROP COLUMN IF EXISTS "sports_attributes";`
    )
  }
}
