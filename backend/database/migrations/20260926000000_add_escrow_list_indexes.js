/**
 * Migration: Add composite DB indexes on escrows for escrow list query performance
 * Version:   20260926000000_add_escrow_list_indexes
 *
 * Context (issue #364):
 *   The escrow list query filters by tenant and status. Without a composite
 *   index on (tenant_id, status) the query triggers a full-table scan on large
 *   datasets. This migration materializes the indexes that are already declared
 *   in schema.prisma so that both ORM and raw SQL paths benefit.
 *
 * Indexes added:
 *   1. escrows_tenant_status_idx        — (tenant_id, status)
 *      Covers the primary list filter: WHERE tenant_id = $1 AND status = $2
 *
 *   2. escrows_tenant_status_created_idx — (tenant_id, status, created_at DESC)
 *      Covers filtered + sorted list: ... ORDER BY created_at DESC LIMIT n
 *
 *   3. escrows_client_id_idx            — (client_address)
 *      Fast lookup of all escrows for a given client wallet address.
 *
 *   4. escrows_contractor_id_idx        — (freelancer_address)
 *      Fast lookup of all escrows for a given contractor wallet address.
 *
 * All indexes use CONCURRENTLY so they build without locking the table.
 * IF NOT EXISTS guards make this migration idempotent and safe to re-run.
 *
 * Rollback:
 *   The down() function drops the indexes. No data is deleted.
 *   Existing rows are completely unaffected by both up() and down().
 */

export const version = '20260926000000';
export const name = 'add_escrow_list_indexes';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function up(prisma) {
  // 1. Composite index on (tenant_id, status) — the primary list-query filter.
  //    Matches: WHERE tenant_id = $1 AND status = $2
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS escrows_tenant_status_idx
      ON escrows (tenant_id, status)
  `);

  // 2. Composite index on (tenant_id, status, created_at DESC) — filtered + sorted list.
  //    Matches: WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT n
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS escrows_tenant_status_created_idx
      ON escrows (tenant_id, status, created_at DESC)
  `);

  // 3. Index on client_address — covers getUserEscrows / client dashboard queries.
  //    Also used in the OR-based user escrows query:
  //    WHERE client_address = $1 OR freelancer_address = $1
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS escrows_client_address_idx
      ON escrows (client_address)
  `);

  // 4. Index on freelancer_address — mirrors client_address for the contractor side.
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS escrows_freelancer_address_idx
      ON escrows (freelancer_address)
  `);
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function down(prisma) {
  await prisma.$executeRawUnsafe(
    `DROP INDEX CONCURRENTLY IF EXISTS escrows_tenant_status_idx`,
  );
  await prisma.$executeRawUnsafe(
    `DROP INDEX CONCURRENTLY IF EXISTS escrows_tenant_status_created_idx`,
  );
  await prisma.$executeRawUnsafe(
    `DROP INDEX CONCURRENTLY IF EXISTS escrows_client_address_idx`,
  );
  await prisma.$executeRawUnsafe(
    `DROP INDEX CONCURRENTLY IF EXISTS escrows_freelancer_address_idx`,
  );
}
