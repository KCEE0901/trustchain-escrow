/**
 * Database Seed Script
 *
 * Populates the database with realistic development/test data.
 * Safe to run multiple times — uses upsert throughout.
 *
 * Usage:
 *   cd backend && node database/seed/index.js
 *   cd backend && node database/seed/index.js --reset   # clears data first
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_SLUG,
  TENANTS,
  USERS,
  FEATURE_FLAGS,
  ESCROWS,
  MILESTONES,
  REPUTATION,
} from './data.js';

export const prisma = new PrismaClient();

/**
 * Validates the runtime environment before permitting any seeding.
 * Prevents accidental execution against production databases.
 *
 * @param {object} [env=process.env]
 * @throws {Error} if environment is production or database URL indicates production
 */
export function validateEnvironment(env = process.env) {
  const nodeEnv = (env.NODE_ENV || '').toLowerCase().trim();
  const appEnv = (env.APP_ENV || '').toLowerCase().trim();

  if (nodeEnv === 'production' || appEnv === 'production') {
    throw new Error(
      'Seed execution aborted: Refusing to seed database in production environment (NODE_ENV/APP_ENV is production).',
    );
  }

  const dbUrl = env.DATABASE_URL || '';
  if (!dbUrl) {
    throw new Error('Seed execution aborted: DATABASE_URL environment variable is missing.');
  }

  const isProdHost =
    dbUrl.includes('prod.') ||
    dbUrl.includes('-prod') ||
    dbUrl.includes('.production') ||
    (dbUrl.includes('rds.amazonaws.com') && !dbUrl.includes('dev') && !dbUrl.includes('test')) ||
    (dbUrl.includes('supabase.co') && env.ALLOW_REMOTE_SEED !== 'true');

  if (isProdHost) {
    throw new Error(
      'Seed execution aborted: DATABASE_URL appears to target a production database host.',
    );
  }

  return true;
}

/**
 * Validates that all required records (tenant, admin, feature flags, sample escrows)
 * were successfully created in the database.
 *
 * @param {PrismaClient} client
 * @returns {Promise<object>} Summary of validated seed counts
 */
export async function validateSeedRecords(client) {
  // 1. Verify tenant exists
  const tenant = await client.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
  });
  if (!tenant) {
    throw new Error(`Seed validation failed: Default tenant "${DEFAULT_TENANT_SLUG}" not found.`);
  }

  // 2. Verify admin user exists
  const adminUser = await client.user.findFirst({
    where: {
      role: 'admin',
      tenantId: tenant.id,
    },
  });
  if (!adminUser) {
    throw new Error('Seed validation failed: Required admin user not found.');
  }

  // 3. Verify feature flags exist
  const flags = await client.featureFlag.findMany();
  if (flags.length < FEATURE_FLAGS.length) {
    throw new Error(
      `Seed validation failed: Expected at least ${FEATURE_FLAGS.length} feature flags, found ${flags.length}.`,
    );
  }

  // 4. Verify sample escrows exist
  const escrows = await client.escrow.findMany({
    where: { tenantId: tenant.id },
  });
  if (escrows.length < ESCROWS.length) {
    throw new Error(
      `Seed validation failed: Expected at least ${ESCROWS.length} sample escrows, found ${escrows.length}.`,
    );
  }

  return {
    tenantId: tenant.id,
    adminEmail: adminUser.email,
    flagsCount: flags.length,
    escrowsCount: escrows.length,
  };
}

/**
 * Executes the database seed with validation and idempotency.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.reset=false]
 * @param {PrismaClient} [options.client=prisma]
 */
export async function runSeed({ reset = false, client = prisma } = {}) {
  // Step 1: Validate environment
  validateEnvironment();
  console.log('🌱 Seeding database…\n');

  if (reset) {
    console.log('🗑  Resetting data…');
    await client.$transaction([
      client.dispute.deleteMany(),
      client.milestone.deleteMany(),
      client.escrow.deleteMany(),
      client.reputationRecord.deleteMany(),
      client.user.deleteMany(),
      client.featureFlag.deleteMany(),
      client.tenant.deleteMany(),
    ]);
    console.log('   Done.\n');
  }

  // 1. Seed Tenants
  for (const t of TENANTS) {
    await client.tenant.upsert({
      where: { slug: t.slug },
      update: { name: t.name, status: t.status },
      create: t,
    });
  }
  console.log(`✅ Tenants:      ${TENANTS.length}`);

  // 2. Seed Users (including Admin)
  for (const u of USERS) {
    await client.user.upsert({
      where: { email: u.email },
      update: {
        role: u.role,
        tenantId: u.tenantId,
        walletAddress: u.walletAddress,
      },
      create: u,
    });
  }
  console.log(`✅ Users:        ${USERS.length} (including admin)`);

  // 3. Seed Feature Flags
  for (const f of FEATURE_FLAGS) {
    await client.featureFlag.upsert({
      where: { key: f.key },
      update: {
        isEnabled: f.isEnabled,
        percentage: f.percentage,
        description: f.description,
      },
      create: f,
    });
  }
  console.log(`✅ Feature Flags:${FEATURE_FLAGS.length}`);

  // 4. Seed Escrows
  for (const e of ESCROWS) {
    await client.escrow.upsert({
      where: { id: e.id },
      update: {
        status: e.status,
        remainingBalance: e.remainingBalance,
        updatedAt: e.updatedAt,
      },
      create: e,
    });
  }
  console.log(`✅ Escrows:      ${ESCROWS.length}`);

  // 5. Seed Milestones
  for (const m of MILESTONES) {
    await client.milestone.upsert({
      where: {
        escrowId_milestoneIndex: { escrowId: m.escrowId, milestoneIndex: m.milestoneIndex },
      },
      update: { status: m.status, submittedAt: m.submittedAt, resolvedAt: m.resolvedAt },
      create: m,
    });
  }
  console.log(`✅ Milestones:   ${MILESTONES.length}`);

  // 6. Seed Reputation
  for (const r of REPUTATION) {
    await client.reputationRecord.upsert({
      where: { address: r.address },
      update: r,
      create: r,
    });
  }
  console.log(`✅ Reputation:   ${REPUTATION.length}`);

  // Step 2: Validate seed records
  const validationSummary = await validateSeedRecords(client);
  console.log(
    `\n✅ Seed validation passed: Verified Tenant "${DEFAULT_TENANT_SLUG}", Admin "${validationSummary.adminEmail}", ${validationSummary.flagsCount} flags, ${validationSummary.escrowsCount} escrows.`,
  );
  console.log('\n✅ Seed complete.');

  return validationSummary;
}

// Auto-run if executed directly as entrypoint
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('seed/index.js') || process.argv[1].endsWith('seed\\index.js'));

if (isDirectRun) {
  const reset = process.argv.includes('--reset');
  runSeed({ reset })
    .catch((err) => {
      console.error('❌ Seed failed:', err.message);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
