/**
 * Database Seed Script
 *
 * Populates the PostgreSQL database with realistic test data
 * for local development. Does NOT write to the Stellar blockchain —
 * data is inserted directly into the DB as if it had been indexed.
 *
 * Usage:
 *   cd backend && node ../scripts/seed.js [--count 50] [--dry-run]
 *
 * Options:
 *   --count <n>   Number of generated escrows to add (default: 0, uses fixtures)
 *   --dry-run     Print what would be seeded without writing to DB
 *   --force       Skip the idempotency guard and re-seed even if data exists
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';

// ── CLI argument parsing ──────────────────────────────────────────────────────

export function parseSeedOptions(args = process.argv.slice(2)) {
  const countIndex = args.indexOf('--count');
  return {
    isDryRun: args.includes('--dry-run'),
    forceReseed: args.includes('--force'),
    extraCount:
      countIndex !== -1 ? Math.max(0, parseInt(args[countIndex + 1] ?? '0', 10) || 0) : 0,
  };
}

const SEED_DATA = {
  escrows: [
    {
      id: BigInt(1),
      clientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDE12345FGHIJK',
      freelancerAddress: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDE12345FG',
      tokenAddress: 'USDC_CONTRACT_ADDRESS',
      totalAmount: '2000000000', // 2000 USDC in base units (7 decimals)
      remainingBalance: '1500000000',
      status: 'Active',
      briefHash: 'QmSampleIPFSHash1234567890abcdef',
      createdAt: new Date('2025-03-01'),
      createdLedger: BigInt(100000),
    },
    {
      id: BigInt(2),
      clientAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDE12345FGHIJK',
      freelancerAddress: 'GLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNO12345PQRSTU',
      tokenAddress: 'USDC_CONTRACT_ADDRESS',
      totalAmount: '500000000', // 500 USDC
      remainingBalance: '0',
      status: 'Completed',
      briefHash: 'QmSampleIPFSHash0987654321fedcba',
      createdAt: new Date('2025-02-01'),
      createdLedger: BigInt(95000),
    },
    {
      id: BigInt(3),
      clientAddress: 'GVWXYZ234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890AB',
      freelancerAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDE12345FGHIJK',
      tokenAddress: 'USDC_CONTRACT_ADDRESS',
      totalAmount: '5000000000', // 5000 USDC
      remainingBalance: '3000000000',
      status: 'Disputed',
      briefHash: 'QmDisputedEscrowIPFSHashABCDEF',
      createdAt: new Date('2025-02-15'),
      createdLedger: BigInt(97000),
    },
  ],

  milestones: [
    // Escrow 1 milestones
    {
      escrowId: BigInt(1),
      milestoneIndex: 0,
      title: 'Initial Design Mockups',
      amount: '500000000',
      status: 'Approved',
      descriptionHash: 'QmMilestone1a',
    },
    {
      escrowId: BigInt(1),
      milestoneIndex: 1,
      title: 'Frontend Development',
      amount: '1000000000',
      status: 'Submitted',
      descriptionHash: 'QmMilestone1b',
    },
    {
      escrowId: BigInt(1),
      milestoneIndex: 2,
      title: 'Final Delivery & Review',
      amount: '500000000',
      status: 'Pending',
      descriptionHash: 'QmMilestone1c',
    },
    // Escrow 2 milestones (all approved)
    {
      escrowId: BigInt(2),
      milestoneIndex: 0,
      title: 'Logo Concepts',
      amount: '150000000',
      status: 'Approved',
      descriptionHash: 'QmMilestone2a',
    },
    {
      escrowId: BigInt(2),
      milestoneIndex: 1,
      title: 'Revisions Round 1',
      amount: '200000000',
      status: 'Approved',
      descriptionHash: 'QmMilestone2b',
    },
    {
      escrowId: BigInt(2),
      milestoneIndex: 2,
      title: 'Final Files',
      amount: '150000000',
      status: 'Approved',
      descriptionHash: 'QmMilestone2c',
    },
  ],

  reputationRecords: [
    {
      address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDE12345FGHIJK',
      totalScore: BigInt(120),
      completedEscrows: 8,
      disputedEscrows: 1,
      disputesWon: 0,
      totalVolume: '15000000000',
      lastUpdated: new Date('2025-03-10'),
    },
    {
      address: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDE12345FG',
      totalScore: BigInt(85),
      completedEscrows: 5,
      disputedEscrows: 0,
      disputesWon: 0,
      totalVolume: '8000000000',
      lastUpdated: new Date('2025-03-08'),
    },
  ],
};

let activeSeedRun = null;

function emitSeedTelemetry(logger, event, details = {}) {
  logger.log(
    JSON.stringify({
      service: 'database-seed',
      event,
      ...details,
    }),
  );
}

async function executeSeed({ database, options, logger, now }) {
  const { isDryRun, forceReseed, extraCount } = options;
  const startedAt = now();

  console.log('🌱 Seeding database…\n');
  emitSeedTelemetry(logger, 'seed_started', {
    dryRun: isDryRun,
    forceReseed,
    fixtureEscrows: SEED_DATA.escrows.length,
    fixtureMilestones: SEED_DATA.milestones.length,
    fixtureReputationRecords: SEED_DATA.reputationRecords.length,
    extraCount,
  });

  if (isDryRun) {
    emitSeedTelemetry(logger, 'seed_completed', {
      status: 'dry_run',
      durationMs: now() - startedAt,
    });
    return { status: 'dry_run' };
  }

  if (!database) {
    logger.warn('Seed database adapter is unavailable; no writes were attempted.');
    emitSeedTelemetry(logger, 'seed_degraded', {
      reason: 'database_adapter_unavailable',
      durationMs: now() - startedAt,
    });
    return { status: 'degraded', reason: 'database_adapter_unavailable' };
  }

  // ── Idempotency guard ─────────────────────────────────────────────────────
  // Running seed twice in CI can produce duplicate-key errors or corrupt test
  // baseline data. The guard checks for existing rows before writing and
  // aborts unless --force is passed, making the script safe to run in pipelines.

  try {
    const existingCount = await database.escrow.count();
    if (existingCount > 0) {
      if (!forceReseed) {
        logger.log(`Database already contains ${existingCount} escrow(s); seed skipped.`);
        emitSeedTelemetry(logger, 'seed_skipped', {
          reason: 'existing_data',
          existingEscrowCount: existingCount,
          durationMs: now() - startedAt,
        });
        return { status: 'skipped', reason: 'existing_data' };
      }
    }

    await database.$transaction(async (transaction) => {
      if (forceReseed) {
        await transaction.dispute.deleteMany();
        await transaction.milestone.deleteMany();
        await transaction.escrow.deleteMany();
        await transaction.reputationRecord.deleteMany();
      }

      for (const escrow of SEED_DATA.escrows) {
        await transaction.escrow.upsert({
          where: { id: escrow.id },
          update: {},
          create: escrow,
        });
      }

      for (const milestone of SEED_DATA.milestones) {
        await transaction.milestone.upsert({
          where: {
            escrowId_milestoneIndex: {
              escrowId: milestone.escrowId,
              milestoneIndex: milestone.milestoneIndex,
            },
          },
          update: {},
          create: milestone,
        });
      }

      for (const reputationRecord of SEED_DATA.reputationRecords) {
        await transaction.reputationRecord.upsert({
          where: { address: reputationRecord.address },
          update: {},
          create: reputationRecord,
        });
      }
    });

    emitSeedTelemetry(logger, 'seed_completed', {
      status: 'success',
      durationMs: now() - startedAt,
    });
    return { status: 'success' };
  } catch (error) {
    if (['ECONNREFUSED', 'P1001', 'P1002'].includes(error.code)) {
      logger.warn('Seed database is unavailable; no further writes will be attempted.');
      emitSeedTelemetry(logger, 'seed_degraded', {
        reason: 'database_unavailable',
        errorType: error.name || 'Error',
        durationMs: now() - startedAt,
      });
      return { status: 'degraded', reason: 'database_unavailable' };
    }

    emitSeedTelemetry(logger, 'seed_failed', {
      errorType: error.name || 'Error',
      durationMs: now() - startedAt,
    });
    throw error;
  }
}

export function seed({
  database = null,
  options = parseSeedOptions(),
  logger = console,
  now = Date.now,
} = {}) {
  if (activeSeedRun) {
    emitSeedTelemetry(logger, 'seed_joined', { reason: 'run_in_progress' });
    return activeSeedRun;
  }

  activeSeedRun = executeSeed({ database, options, logger, now }).finally(() => {
    activeSeedRun = null;
  });
  return activeSeedRun;
}

async function main() {
  let database;
  try {
    ({ default: database } = await import('../backend/lib/prisma.js'));
    const result = await seed({ database });
    if (result.status === 'degraded') process.exitCode = 1;
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await database?.$disconnect?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
