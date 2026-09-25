import { Worker } from 'bullmq';
import prisma from '../lib/prisma.js';
import { connection } from '../queues/index.js';
import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('webhookWorker');

export async function processWebhookJob(job) {
  const { url, payload, headers = {}, deliveryId } = job.data;
  const attempts = job.attemptsMade + 1;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook failed: ${response.status} ${errorText}`);
    }

    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'success',
        responseCode: response.status,
        attempts,
        lastAttemptAt: new Date(),
      },
    });

    // Log successful recovery on any attempt after the first
    if (attempts > 1) {
      log.info({
        message: 'webhook_delivery_recovered',
        status: 'recovered',
        jobId: job.id,
        deliveryId,
        // Strip auth tokens from the URL before logging
        endpoint: sanitizeUrl(url),
        attemptNumber: attempts,
        responseCode: response.status,
      });
    } else {
      log.info({
        message: 'webhook_delivery_success',
        jobId: job.id,
        deliveryId,
        endpoint: sanitizeUrl(url),
        attemptNumber: attempts,
        responseCode: response.status,
      });
    }
  } catch (err) {
    const maxAttempts = job.opts.attempts ?? 1;
    const isTerminal = attempts >= maxAttempts;

    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: isTerminal ? 'failed' : 'pending',
        errorMessage: err.message,
        attempts,
        lastAttemptAt: new Date(),
      },
    });

    if (isTerminal) {
      // Final failure — job is moving to the dead-letter set
      log.error({
        message: 'webhook_delivery_dead_letter',
        status: 'dead_letter',
        jobId: job.id,
        deliveryId,
        endpoint: sanitizeUrl(url),
        attemptNumber: attempts,
        maxAttempts,
        error: err.message,
      });
    } else {
      // Intermediate failure — will be retried
      log.warn({
        message: 'webhook_delivery_retry',
        jobId: job.id,
        deliveryId,
        endpoint: sanitizeUrl(url),
        attemptNumber: attempts,
        maxAttempts,
        error: err.message,
      });
    }

    throw err;
  }
}

/**
 * Remove any auth tokens embedded in query-string parameters before logging
 * so credentials never appear in log output.
 *
 * @param {string} rawUrl
 * @returns {string} sanitized URL string
 */
function sanitizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const sensitiveParams = ['token', 'secret', 'key', 'auth', 'password', 'api_key', 'apikey'];
    for (const param of sensitiveParams) {
      if (u.searchParams.has(param)) {
        u.searchParams.set(param, '[REDACTED]');
      }
    }
    return u.toString();
  } catch {
    // If the URL is somehow unparseable, return a safe placeholder
    return '[INVALID_URL]';
  }
}

const webhookWorker =
  process.env.NODE_ENV === 'test'
    ? null
    : new Worker('webhook', processWebhookJob, {
        connection,
      });

// ── Structured retry event listeners ─────────────────────────────────────────
// BullMQ emits 'failed' on every failed attempt (including retryable ones)
// and 'completed' on final success. We use these to emit the consolidated
// structured log entries required by issue #374.

if (webhookWorker) {
  webhookWorker.on('failed', (job, err) => {
    if (!job) return;
    const { url, deliveryId } = job.data ?? {};
    const attemptNumber = job.attemptsMade; // attemptsMade is incremented before the event fires
    const maxAttempts = job.opts?.attempts ?? 1;
    const isDeadLetter = attemptNumber >= maxAttempts;

    log.error({
      message: isDeadLetter ? 'webhook_job_dead_letter' : 'webhook_job_failed',
      ...(isDeadLetter ? { status: 'dead_letter' } : {}),
      jobId: job.id,
      webhookId: deliveryId ?? null,
      endpoint: url ? sanitizeUrl(url) : null,
      attemptNumber,
      maxAttempts,
      error: err?.message ?? String(err),
    });
  });

  webhookWorker.on('completed', (job) => {
    if (!job) return;
    const { url, deliveryId } = job.data ?? {};
    const attemptNumber = job.attemptsMade;

    // Only emit the recovered log here when BullMQ reports completion after
    // one or more prior failures (processWebhookJob already logs first-try success).
    if (attemptNumber > 1) {
      log.info({
        message: 'webhook_job_recovered',
        status: 'recovered',
        jobId: job.id,
        webhookId: deliveryId ?? null,
        endpoint: url ? sanitizeUrl(url) : null,
        attemptNumber,
      });
    }
  });
}

export default webhookWorker;
