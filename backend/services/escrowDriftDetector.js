/**
 * Escrow Status Drift Detector
 *
 * Compares the database status of each escrow against the status implied by
 * its indexed contract events and flags records that look stale (DB status
 * differs from the chain) or impossible (event sequence violates the escrow
 * lifecycle, e.g. a dispute raised after cancellation).
 */

import prisma from '../lib/prisma.js';

/** Contract events that set an escrow status (mirrors escrowIndexer handlers). */
export const STATUS_EVENTS = {
  esc_crt: 'Active',
  dis_rai: 'Disputed',
  dis_res: 'Completed',
  esc_can: 'Cancelled',
};

const TERMINAL = new Set(['Completed', 'Cancelled']);

function serializeEvent(event) {
  if (!event) return null;
  return {
    eventType: event.eventType,
    ledger: event.ledger?.toString() ?? null,
    ledgerAt: event.ledgerAt ?? null,
    txHash: event.txHash ?? null,
  };
}

/**
 * Infer chain status from an escrow's events (ordered oldest first) and
 * compare it with the DB status.
 *
 * @param {{ id: bigint|string, status: string }} escrow
 * @param {Array<object>} events
 * @returns {null | { escrowId: string, dbStatus: string, inferredStatus: string|null, lastEvent: object|null, reason: string }}
 */
export function detectDrift(escrow, events = []) {
  let inferred = null;
  let impossible = null;

  for (const event of events) {
    const next = STATUS_EVENTS[event.eventType];
    if (!next) continue;
    if (inferred && TERMINAL.has(inferred) && !impossible) {
      impossible = `${event.eventType} after terminal status ${inferred}`;
    }
    inferred = next;
  }

  const base = {
    escrowId: escrow.id.toString(),
    dbStatus: escrow.status,
    inferredStatus: inferred,
    lastEvent: serializeEvent(events[events.length - 1]),
  };

  if (impossible) return { ...base, reason: `impossible_sequence: ${impossible}` };
  if (!inferred) return { ...base, reason: 'no_status_events' };
  if (inferred !== escrow.status) return { ...base, reason: 'stale_status' };
  return null;
}

/**
 * Scan escrows and return every record whose DB status drifts from the chain.
 *
 * @param {object} [opts]
 * @param {number} [opts.batchSize=500]
 * @param {string} [opts.tenantId]
 * @returns {Promise<Array<object>>}
 */
export async function findStatusDrift({ batchSize = 500, tenantId } = {}) {
  const escrows = await prisma.escrow.findMany({
    where: tenantId ? { tenantId } : {},
    select: { id: true, status: true },
    take: batchSize,
    orderBy: { id: 'asc' },
  });
  if (escrows.length === 0) return [];

  const events = await prisma.contractEvent.findMany({
    where: { escrowId: { in: escrows.map((e) => e.id) } },
    orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
  });

  const byEscrow = new Map();
  for (const event of events) {
    const key = event.escrowId.toString();
    if (!byEscrow.has(key)) byEscrow.set(key, []);
    byEscrow.get(key).push(event);
  }

  return escrows
    .map((escrow) => detectDrift(escrow, byEscrow.get(escrow.id.toString()) ?? []))
    .filter(Boolean);
}

export default { detectDrift, findStatusDrift };
