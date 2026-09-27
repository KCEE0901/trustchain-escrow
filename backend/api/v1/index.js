import express from 'express';
import { versioning } from '../middleware/version.js';

import disputeRoutes from '../routes/disputeRoutes.js';
import escrowRoutes from '../routes/escrowRoutes.js';
import eventRoutes from '../routes/eventRoutes.js';
import kycRoutes from '../routes/kycRoutes.js';
import notificationRoutes from '../routes/notificationRoutes.js';
import paymentRoutes from '../routes/paymentRoutes.js';
import reputationRoutes from '../routes/reputationRoutes.js';
import userRoutes from '../routes/userRoutes.js';
import auditRoutes from '../routes/auditRoutes.js';
import complianceRoutes from '../routes/complianceRoutes.js';
import authRoutes from '../routes/authRoutes.js';
import escrowController, { validateEscrowId } from '../controllers/escrowController.js';
import reputationController from '../controllers/reputationController.js';
import { invalidateOn } from '../middleware/cache.js';

const router = express.Router();

// Apply v1 versioning to all routes in this router
router.use(versioning('v1'));

router.use('/auth', authRoutes);
router.patch(
  '/escrows/:id/status',
  validateEscrowId,
  invalidateOn({ tags: (req) => ['escrows', `escrow:${req.params.id}`] }),
  escrowController.updateEscrowStatus,
);

router.use('/escrows', escrowRoutes);
// Registered ahead of `router.use('/users', userRoutes)` (which requires auth
// for every route on that router) so this specific, explicitly-public
// endpoint (#455) is served without ever reaching that auth gate.
router.get('/users/:address/reputation/events', reputationController.getReputationEvents);
router.use('/users', userRoutes);
router.use('/reputation', reputationRoutes);
router.use('/disputes', disputeRoutes);
router.use('/notifications', notificationRoutes);
router.use('/events', eventRoutes);
router.use('/kyc', kycRoutes);
router.use('/payments', paymentRoutes);
router.use('/audit', auditRoutes);
router.use('/compliance', complianceRoutes);

export default router;
