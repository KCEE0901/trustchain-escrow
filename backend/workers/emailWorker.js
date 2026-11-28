import { Worker } from 'bullmq';
import crypto from 'crypto';
import { connection } from '../queues/index.js';
import { runWithCorrelation } from '../config/logger.js';

import disputeRaisedTemplate from '../templates/emails/disputeRaised.js';
import escrowStatusChangedTemplate from '../templates/emails/escrowStatusChanged.js';
import milestoneCompletedTemplate from '../templates/emails/milestoneCompleted.js';

const config = {
  provider: process.env.EMAIL_PROVIDER || 'console',
  fromEmail: process.env.EMAIL_FROM || 'no-reply@stellartrustescrow.local',
  fromName: process.env.EMAIL_FROM_NAME || 'Stellar Trust Escrow',
  sendgridApiKey: process.env.SENDGRID_API_KEY || '',
  // Explicit opt-in: 'console' or 'sendgrid'. Unset/'none' disables fallback.
  fallbackProvider: process.env.EMAIL_FALLBACK_PROVIDER || 'none',
};

function createTemplate(eventType, payload) {
  switch (eventType) {
    case 'escrow.status_changed':
      return escrowStatusChangedTemplate(payload);
    case 'milestone.completed':
      return milestoneCompletedTemplate(payload);
    case 'dispute.raised':
      return disputeRaisedTemplate(payload);
    default:
      throw new Error(`Unsupported notification event type: ${eventType}`);
  }
}

async function sendViaConsole(message, eventType) {
  console.log('[EmailWorker] Console delivery', {
    to: message.to.email,
    subject: message.subject,
    eventType,
  });
  return {
    provider: 'console',
    messageId: `console-${crypto.randomUUID()}`,
  };
}

async function sendViaSendgrid(message, eventType, cfg) {
  if (!cfg.sendgridApiKey) throw new Error('SendGrid API key is not configured');

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.sendgridApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: message.to.email, name: message.to.name }],
          subject: message.subject,
        },
      ],
      from: {
        email: cfg.fromEmail,
        name: cfg.fromName,
      },
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
      custom_args: {
        eventType,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SendGrid failed: ${response.status} ${errorText}`);
  }

  return {
    provider: 'sendgrid',
    messageId: response.headers.get('x-message-id') || `sendgrid-${crypto.randomUUID()}`,
  };
}

const providers = { console: sendViaConsole, sendgrid: sendViaSendgrid };

function resolvePrimary(cfg) {
  // Preserve legacy behaviour: SendGrid without an API key delivers to console.
  if (cfg.provider === 'sendgrid' && !cfg.sendgridApiKey) return 'console';
  return providers[cfg.provider] ? cfg.provider : 'console';
}

export async function sendWithProvider(message, eventType, cfg = config) {
  const primary = resolvePrimary(cfg);
  try {
    const result = await providers[primary](message, eventType, cfg);
    console.log(`[EmailWorker] Delivered via primary provider: ${result.provider}`);
    return result;
  } catch (err) {
    const fallback = cfg.fallbackProvider;
    if (!providers[fallback] || fallback === primary) {
      console.error(
        `[EmailWorker] Primary provider ${primary} failed, fallback disabled`,
        err.message,
      );
      throw err;
    }
    console.warn(
      `[EmailWorker] Primary provider ${primary} failed (${err.message}); falling back to ${fallback}`,
    );
    const result = await providers[fallback](message, eventType, cfg);
    console.log(`[EmailWorker] Delivered via fallback provider: ${result.provider}`);
    return { ...result, fallback: true };
  }
}

const emailWorker = new Worker(
  'email',
  async (job) =>
    runWithCorrelation(job.data?.correlationId, async () => {
      const { eventType, payload, recipients, correlationId } = job.data;

      for (const rawRecipient of recipients) {
        const recipient = {
          email: rawRecipient.email.toLowerCase().trim(),
          name: rawRecipient.name || rawRecipient.address || rawRecipient.email,
        };

        const template = createTemplate(eventType, payload);
        const content = template({
          recipient,
          unsubscribeUrl: `/api/notifications/unsubscribe?email=${encodeURIComponent(recipient.email)}&token=TOKEN_PLACEHOLDER`, // Migrate unsubscribe logic later
          fromName: config.fromName,
        });

        const message = {
          to: recipient,
          subject: content.subject,
          text: content.text,
          html: content.html,
        };

        const result = await sendWithProvider(message, eventType);
        console.log(
          `[EmailWorker] Sent to ${recipient.email}: ${result.messageId} correlationId=${correlationId ?? '-'}`,
        );
      }
    }),
  {
    connection,
  },
);

export default emailWorker;
