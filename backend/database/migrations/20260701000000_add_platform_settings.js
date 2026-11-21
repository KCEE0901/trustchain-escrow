/**
 * Migration: Add platform_settings table for dynamic admin settings
 * Version:   20260701000000_add_platform_settings
 *
 * Stores admin overrides for platform settings (key → string value). The
 * admin API treats this table as optional and falls back to env defaults
 * when it is unavailable.
 */

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function up(prisma) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function down(prisma) {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS platform_settings`);
}
