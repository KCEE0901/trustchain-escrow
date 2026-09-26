import express from 'express';
import webhookController from '../controllers/webhookController.js';
import { createSlidingWindowRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Apply a per-user sliding-window rate limit to the subscribe endpoint.
// Keyed by authenticated user ID so the limit is isolated per account, not
// global or IP-based.  10 requests per 60-second window is generous for
// legitimate use while preventing subscription-flooding / DoS.
// Returns HTTP 429 with Retry-After when the limit is exceeded.
const subscribeRateLimit = createSlidingWindowRateLimiter({
  windowMs: 60 * 1000, // 1-minute sliding window
  max: 10,
  prefix: 'webhook-subscribe',
  keyGenerator: (req) =>
    req.user?.id
      ? `webhook-subscribe:user:${req.user.id}`
      : `webhook-subscribe:ip:${req.ip ?? 'unknown'}`,
  message: 'Too many webhook subscription requests — try again later',
});

router.post('/subscribe', subscribeRateLimit, webhookController.subscribe);
router.get('/', webhookController.listSubscriptions);
router.delete('/:id', webhookController.deleteSubscription);
router.get('/:id/deliveries', webhookController.getDeliveries);

export default router;
