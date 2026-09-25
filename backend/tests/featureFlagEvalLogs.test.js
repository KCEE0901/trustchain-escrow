/**
 * Tests — Feature Flag Evaluation Logs (Issue #199)
 *
 * Covers:
 *  - Missing flag emits reason 'flag_not_found'
 *  - Globally disabled flag emits 'flag_globally_disabled'
 *  - Explicitly targeted user emits 'explicit_targeting'
 *  - Tenant override emits 'tenant_override' with correct tenantId
 *  - Percentage rollout emits 'percentage_rollout_matched' or 'percentage_rollout_missed'
 *  - Sample rate 0 suppresses all log calls
 *  - Sample rate 1 always logs
 *  - Log lines never contain userId (PII guard)
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ── Mock prisma ───────────────────────────────────────────────────────────────

const flagStore = new Map();

const prismaMock = {
  featureFlag: {
    findUnique: jest.fn(({ where }) => Promise.resolve(flagStore.get(where.key) ?? null)),
    findMany: jest.fn(() => Promise.resolve([...flagStore.values()])),
    create: jest.fn(({ data }) => {
      flagStore.set(data.key, { ...data });
      return Promise.resolve(flagStore.get(data.key));
    }),
    update: jest.fn(({ where, data }) => {
      const existing = flagStore.get(where.key);
      if (!existing) throw Object.assign(new Error('Not found'), { code: 'P2025' });
      const updated = { ...existing, ...data };
      flagStore.set(where.key, updated);
      return Promise.resolve(updated);
    }),
    delete: jest.fn(({ where }) => { flagStore.delete(where.key); return Promise.resolve(); }),
  },
  tenantFeatureFlagOverride: {
    findUnique: jest.fn(() => Promise.resolve(null)),
    upsert: jest.fn(() => Promise.resolve()),
    delete: jest.fn(() => Promise.resolve()),
  },
  auditLog: { create: jest.fn(() => Promise.resolve()) },
};

// ── Mock logger ───────────────────────────────────────────────────────────────

const loggerInfoMock = jest.fn();
const loggerMock = { info: loggerInfoMock, warn: jest.fn(), error: jest.fn() };

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../config/logger.js', () => ({
  getLogger: () => loggerMock,
  createModuleLogger: () => loggerMock,
  logControllerError: jest.fn(),
}));

// ── Import SUT after mocks ────────────────────────────────────────────────────

const { isFeatureEnabled, createFlag } = await import('../services/featureFlags.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function setSampleRate(rate) {
  process.env.FLAG_EVAL_SAMPLE_RATE = String(rate);
}

function getEvalLogs() {
  return loggerInfoMock.mock.calls
    .map(([arg]) => arg)
    .filter((a) => a?.type === 'feature_flag_evaluation');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Feature Flag Evaluation Logs (#199)', () => {
  beforeEach(() => {
    flagStore.clear();
    jest.clearAllMocks();
    setSampleRate(1); // always log during tests
    prismaMock.tenantFeatureFlagOverride.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.FLAG_EVAL_SAMPLE_RATE;
  });

  // ── Missing flag ────────────────────────────────────────────────────────────
  it('logs reason=flag_not_found when the flag does not exist', async () => {
    await isFeatureEnabled('nonexistent', { id: 'user-1' });
    const logs = getEvalLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].reason).toBe('flag_not_found');
    expect(logs[0].flag).toBe('nonexistent');
    expect(logs[0].variant).toBe('disabled');
  });

  // ── Globally disabled flag ──────────────────────────────────────────────────
  it('logs reason=flag_globally_disabled for a disabled flag with no targeting', async () => {
    await createFlag({ key: 'off-flag', isEnabled: false, percentage: 0, targetUsers: [] }, 'admin');
    await isFeatureEnabled('off-flag', { id: 'user-99' });
    const logs = getEvalLogs();
    expect(logs.some((l) => l.reason === 'flag_globally_disabled')).toBe(true);
  });

  // ── Explicit targeting ──────────────────────────────────────────────────────
  it('logs reason=explicit_targeting for a user in targetUsers', async () => {
    await createFlag(
      { key: 'beta', isEnabled: false, percentage: 0, targetUsers: ['user-42'] },
      'admin',
    );
    await isFeatureEnabled('beta', { id: 'user-42' });
    const logs = getEvalLogs();
    expect(logs.some((l) => l.reason === 'explicit_targeting' && l.variant === 'enabled')).toBe(true);
  });

  // ── Tenant override ─────────────────────────────────────────────────────────
  it('logs reason=tenant_override with tenantId when a tenant override is set', async () => {
    await createFlag({ key: 'feature-x', isEnabled: false, percentage: 0, targetUsers: [] }, 'admin');
    prismaMock.tenantFeatureFlagOverride.findUnique.mockResolvedValue({
      tenantId: 'tenant-abc',
      flagKey: 'feature-x',
      isEnabled: true,
    });

    await isFeatureEnabled('feature-x', { id: 'user-1', tenantId: 'tenant-abc' });
    const logs = getEvalLogs();
    expect(logs.some((l) => l.reason === 'tenant_override' && l.tenantId === 'tenant-abc')).toBe(true);
  });

  // ── Percentage rollout ──────────────────────────────────────────────────────
  it('logs percentage_rollout_matched or percentage_rollout_missed for an enabled flag', async () => {
    await createFlag({ key: 'rollout', isEnabled: true, percentage: 50, targetUsers: [] }, 'admin');
    await isFeatureEnabled('rollout', { id: 'user-7' });
    const logs = getEvalLogs();
    const reasons = logs.map((l) => l.reason);
    const validReasons = ['percentage_rollout_matched', 'percentage_rollout_missed'];
    expect(reasons.some((r) => validReasons.includes(r))).toBe(true);
  });

  // ── Sample rate 0 — no logs ─────────────────────────────────────────────────
  it('does not emit any log when sample rate is 0', async () => {
    setSampleRate(0);
    await createFlag({ key: 'silent', isEnabled: true, percentage: 100, targetUsers: [] }, 'admin');
    await isFeatureEnabled('silent', { id: 'user-1' });
    const logs = getEvalLogs();
    expect(logs).toHaveLength(0);
  });

  // ── PII guard — userId not in log ───────────────────────────────────────────
  it('never includes userId in evaluation log lines', async () => {
    await createFlag({ key: 'pii-test', isEnabled: true, percentage: 100, targetUsers: [] }, 'admin');
    await isFeatureEnabled('pii-test', { id: 'secret-user-id-12345' });
    const logs = getEvalLogs();
    logs.forEach((l) => {
      expect(JSON.stringify(l)).not.toContain('secret-user-id-12345');
    });
  });

  // ── Log fields ──────────────────────────────────────────────────────────────
  it('log lines include type, flag, variant, and reason fields', async () => {
    await createFlag({ key: 'shape-test', isEnabled: true, percentage: 100, targetUsers: [] }, 'admin');
    await isFeatureEnabled('shape-test', { id: 'user-1' });
    const logs = getEvalLogs();
    expect(logs.length).toBeGreaterThan(0);
    const entry = logs[0];
    expect(entry).toHaveProperty('type', 'feature_flag_evaluation');
    expect(entry).toHaveProperty('flag');
    expect(entry).toHaveProperty('variant');
    expect(entry).toHaveProperty('reason');
  });
});
