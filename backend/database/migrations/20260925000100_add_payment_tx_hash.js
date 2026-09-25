/**
 * Migration: Link payments to on-chain submissions for reconciliation
 * Version:   20260925000100_add_payment_tx_hash
 */

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function up(prisma) {
  await prisma.$executeRawUnsafe(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS tx_hash TEXT`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS payments_tx_hash_idx ON payments(tx_hash)`,
  );
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function down(prisma) {
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS payments_tx_hash_idx`);
  await prisma.$executeRawUnsafe(`ALTER TABLE payments DROP COLUMN IF EXISTS tx_hash`);
}
