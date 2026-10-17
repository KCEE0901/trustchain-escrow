import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  configureAlertEmailSender,
  emailAlert,
  resetAlertEmailDeliveryState,
} from '../services/alertService.js';

const alert = {
  type: 'high_failure_rate',
  severity: 'error',
  message: 'Failure threshold exceeded',
  timestamp: '2026-01-01T00:00:00.000Z',
  service: 'stellar-event-queue',
};

describe('alert email delivery', () => {
  beforeEach(() => {
    resetAlertEmailDeliveryState();
    process.env.ALERT_EMAIL_RECIPIENTS = 'ops@example.com';
  });

  it('delivers an alert through the configured sender', async () => {
    const sender = jest.fn().mockResolvedValue(undefined);
    configureAlertEmailSender(sender);

    await expect(emailAlert(alert)).resolves.toMatchObject({ status: 'delivered' });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('does not deliver the same alert twice', async () => {
    const sender = jest.fn().mockResolvedValue(undefined);
    configureAlertEmailSender(sender);

    await emailAlert(alert);
    await expect(emailAlert(alert)).resolves.toMatchObject({ status: 'duplicate' });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('reports a degraded result when delivery fails', async () => {
    configureAlertEmailSender(jest.fn().mockRejectedValue(new Error('provider unavailable')));

    await expect(emailAlert(alert)).resolves.toEqual({
      status: 'degraded',
      reason: 'email_delivery_failed',
    });
  });

  it('reports a degraded result when no sender is configured', async () => {
    await expect(emailAlert(alert)).resolves.toEqual({
      status: 'degraded',
      reason: 'email_transport_unavailable',
    });
  });
});
