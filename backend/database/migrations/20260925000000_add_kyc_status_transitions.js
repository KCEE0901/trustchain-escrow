/**
 * Migration: Add KycStatusTransition table for KYC status audit history
 * Version:   20260925000000_add_kyc_status_transitions
 */

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function up(prisma) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS kyc_status_transitions (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      address         TEXT NOT NULL,
      actor           TEXT NOT NULL,
      source          TEXT NOT NULL,
      previous_status "KycStatus",
      new_status      "KycStatus" NOT NULL,
      reason          TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT fk_kyc_transition_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS kyc_status_transitions_tenant_address_created_idx
    ON kyc_status_transitions(tenant_id, address, created_at)
  `);
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function down(prisma) {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS kyc_status_transitions`);
}
