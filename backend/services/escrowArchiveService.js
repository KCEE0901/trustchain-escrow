/**
 * Escrow Archive Service
 *
 * Handles scheduled and on-demand archival of completed escrows into
 * time-partitioned archive tables. Supports configurable retention windows
 * and dry-run mode for safe pre-flight checks.
 *
 * @module services/escrowArchiveService
 */

const ARCHIVE_RETENTION_DAYS = parseInt(process.env.ARCHIVE_RETENTION_DAYS || '365', 10);
const ARCHIVE_BATCH_SIZE = parseInt(process.env.ARCHIVE_BATCH_SIZE || '500', 10);

function getArchiveTableName(date = new Date()) {
  const value = new Date(date);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `escrows_archive_${year}_${month}`;
}

function getArchiveWindow(date = new Date()) {
  const safe = new Date(date);
  safe.setUTCSeconds(0, 0);
  const start = new Date(Date.UTC(safe.getUTCFullYear(), safe.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end, tableName: getArchiveTableName(safe) };
}

async function ensureArchivePartition(prisma, date = new Date()) {
  const { tableName, start, end } = getArchiveWindow(date);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${tableName} (LIKE escrows INCLUDING ALL)
  `);

  return { tableName, start, end };
}

/**
 * Archive completed escrows older than the retention window.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} [olderThan]       - cutoff date (defaults to ARCHIVE_RETENTION_DAYS ago)
 * @param {{ dryRun?: boolean, retentionDays?: number, batchSize?: number }} [options]
 * @returns {Promise<{ archived: number, rows: Array, dryRun: boolean }>}
 */
async function archiveCompletedEscrows(
  prisma,
  olderThan,
  { dryRun = false, retentionDays = ARCHIVE_RETENTION_DAYS, batchSize = ARCHIVE_BATCH_SIZE } = {},
) {
  const cutoff = olderThan ?? new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.escrow.findMany({
    where: {
      status: 'Completed',
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  if (!rows.length) return { archived: 0, rows: [], dryRun };

  if (dryRun) {
    const preview = rows.map((row) => ({
      id: row.id,
      tableName: getArchiveWindow(row.createdAt).tableName,
      createdAt: row.createdAt,
    }));
    return { archived: preview.length, rows: preview, dryRun: true };
  }

  const archived = [];

  for (const row of rows) {
    const { tableName } = getArchiveWindow(row.createdAt);
    await ensureArchivePartition(prisma, row.createdAt);
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO ${tableName} (id, tenant_id, client_address, freelancer_address, arbiter_address, token_address, total_amount, remaining_balance, status, brief_hash, deadline, created_at, updated_at, created_ledger)
      SELECT id, tenant_id, client_address, freelancer_address, arbiter_address, token_address, total_amount, remaining_balance, status, brief_hash, deadline, created_at, updated_at, created_ledger
      FROM escrows
      WHERE id = $1
      ON CONFLICT (id) DO NOTHING
    `,
      row.id,
    );
    await prisma.$executeRawUnsafe('DELETE FROM escrows WHERE id = $1', row.id);
    archived.push({ id: row.id, tableName, createdAt: row.createdAt });
  }

  return { archived: archived.length, rows: archived, dryRun: false };
}

/**
 * Get statistics about escrows eligible for archival without moving them.
 * Useful for dashboards and monitoring.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number} [retentionDays]
 * @returns {Promise<{ eligible: number, oldestCreatedAt: Date|null, cutoffDate: Date }>}
 */
async function getArchivalStats(prisma, retentionDays = ARCHIVE_RETENTION_DAYS) {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const [countResult, oldestResult] = await Promise.all([
    prisma.escrow.count({
      where: { status: 'Completed', createdAt: { lt: cutoffDate } },
    }),
    prisma.escrow.findFirst({
      where: { status: 'Completed', createdAt: { lt: cutoffDate } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  return {
    eligible: countResult,
    oldestCreatedAt: oldestResult?.createdAt ?? null,
    cutoffDate,
    retentionDays,
  };
}

async function listArchiveTables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'escrows_archive_%'
    ORDER BY tablename ASC
  `);

  return rows.map((row) => row.tablename);
}

export {
  ARCHIVE_RETENTION_DAYS,
  ARCHIVE_BATCH_SIZE,
  archiveCompletedEscrows,
  ensureArchivePartition,
  getArchiveTableName,
  getArchiveWindow,
  getArchivalStats,
  listArchiveTables,
};

export default {
  ARCHIVE_RETENTION_DAYS,
  ARCHIVE_BATCH_SIZE,
  archiveCompletedEscrows,
  ensureArchivePartition,
  getArchiveTableName,
  getArchiveWindow,
  getArchivalStats,
  listArchiveTables,
};
