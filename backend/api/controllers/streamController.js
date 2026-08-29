/**
 * Stream Controller
 *
 * Lets a client resolve the realtime pub/sub topic for a given escrow so it
 * can subscribe to live updates (see services/escrowRealtime.js).
 *
 * @module streamController
 */

import prisma from '../../lib/prisma.js';
import { logControllerError } from '../../config/logger.js';
import { escrowTopic } from '../../services/escrowRealtime.js';

/**
 * GET /api/stream/:escrowId
 * Resolve the realtime topic for an escrow, after confirming it exists.
 */
const getEscrowStream = async (req, res) => {
  try {
    const { escrowId } = req.params;
    let id;
    try {
      id = BigInt(escrowId);
    } catch {
      return res.status(400).json({ error: 'Invalid escrowId' });
    }

    const escrow = await prisma.escrow.findUnique({ where: { id } });
    if (!escrow) {
      return res.status(404).json({ error: 'Escrow not found' });
    }

    res.json({
      escrowId: escrow.id.toString(),
      topic: escrowTopic(escrowId),
      status: escrow.status,
    });
  } catch (err) {
    logControllerError('stream.getEscrowStream', err, req);
    res.status(500).json({ error: err.message });
  }
};

export default { getEscrowStream };
