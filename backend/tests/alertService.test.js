import {
  ALERT_SEVERITY,
  calculateSyncLag,
  configureAlertService,
  emailAlert,
  lastAlerts,
  pruneAlertHistory,
  sendAlert,
} from '../services/alertService.js';

const alert = (type) => ({ type, severity: ALERT_SEVERITY.WARNING, message: 'deterministic test alert' });

describe('alert delivery resilience', () => {
  beforeEach(() => {
    lastAlerts.clear();
    configureAlertService();
    delete process.env.ALERT_EMAIL_ENABLED;
  });

  it('coalesces concurrent delivery for the same alert type', async () => {
    process.env.ALERT_EMAIL_ENABLED = 'true';
    let release;
    configureAlertService({ sendEmail: () => new Promise((resolve) => { release = resolve; }) });
    const first = sendAlert(alert('concurrent'));
    const second = await sendAlert(alert('concurrent'));
    expect(second).toEqual({ status: 'coalesced', type: 'concurrent' });
    release();
    await expect(first).resolves.toMatchObject({ status: 'sent' });
  });

  it('returns a stable degraded result when email transport is unavailable', async () => {
    await expect(emailAlert(alert('unavailable'))).resolves.toEqual({
      status: 'degraded',
      reason: 'email_transport_unavailable',
    });
  });

  it('bounds retained cooldown history', () => {
    for (let index = 0; index < 1100; index += 1) lastAlerts.set(`type-${index}`, Date.now());
    expect(pruneAlertHistory()).toBeLessThanOrEqual(1000);
  });

  it('retries malformed sync responses and preserves the last known lag', async () => {
    let attempts = 0;
    const lag = await calculateSyncLag({
      getLatestLedger: async () => (++attempts < 3 ? 'bad' : 5000),
      getLastProcessedLedger: async () => 1250,
    });
    expect(attempts).toBe(3);
    expect(lag).toBe(3750);

    await expect(calculateSyncLag({
      getLatestLedger: async () => { throw new Error('offline'); },
      getLastProcessedLedger: async () => 0,
    })).resolves.toBe(3750);
  });
});
