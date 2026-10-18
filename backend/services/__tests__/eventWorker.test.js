'use strict';

/**
 * Tests for event worker configuration validation (issues #605 and #606).
 *
 * These tests exercise the fail-fast validation that runs when the event
 * worker is initialized. They assert the primary success path plus several
 * failure / boundary paths, and verify that error messages are deterministic
 * and never leak secret values.
 */

const { validatePersistenceConfig, validateAlertingConfig } = require('../eventWorker');

const VALID_CONFIG = {
  persistence: {
    enabled: true,
    driver: 'postgres',
    connectionString: 'postgres://user:super-secret@localhost:5432/events',
    batchSize: 100,
    flushIntervalMs: 1000,
    maxRetries: 3,
  },
};

function cloneConfig(overrides = {}) {
  return {
    ...VALID_CONFIG,
    persistence: { ...VALID_CONFIG.persistence, ...overrides },
  };
}

describe('event worker persistence configuration validation', () => {
  describe('success path', () => {
    it('accepts a fully specified, consistent configuration', () => {
      expect(() => validatePersistenceConfig(VALID_CONFIG)).not.toThrow();
      expect(validatePersistenceConfig(VALID_CONFIG)).toEqual({ valid: true, errors: [] });
    });

    it('accepts a disabled persistence configuration without requiring a driver', () => {
      const config = cloneConfig({ enabled: false, driver: undefined });
      expect(validatePersistenceConfig(config)).toEqual({ valid: true, errors: [] });
    });
  });

  describe('failure paths', () => {
    it('rejects an unknown persistence driver with an actionable message', () => {
      const config = cloneConfig({ driver: 'mysql' });
      const result = validatePersistenceConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'persistence.driver "mysql" is not supported; expected one of: postgres, sqlite'
      );
    });

    it('rejects enabled persistence without a connection string', () => {
      const config = cloneConfig({ connectionString: '' });
      const result = validatePersistenceConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'persistence.connectionString is required when persistence.enabled is true'
      );
    });

    it('rejects contradictory retry settings', () => {
      const config = cloneConfig({ maxRetries: -1 });
      const result = validatePersistenceConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('persistence.maxRetries must be a non-negative integer');
    });
  });

  describe('boundary paths', () => {
    it('rejects a non-positive batch size', () => {
      const config = cloneConfig({ batchSize: 0 });
      const result = validatePersistenceConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('persistence.batchSize must be a positive integer');
    });

    it('rejects a flush interval that is not a positive number', () => {
      const config = cloneConfig({ flushIntervalMs: -5 });
      const result = validatePersistenceConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('persistence.flushIntervalMs must be a positive number');
    });

    it('reports every problem at once rather than stopping at the first', () => {
      const config = cloneConfig({ driver: 'mysql', batchSize: 0, maxRetries: -1 });
      const result = validatePersistenceConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('determinism and secret hygiene', () => {
    it('produces identical results across repeated invocations', () => {
      const config = cloneConfig({ driver: 'mysql' });
      const first = validatePersistenceConfig(config);
      const second = validatePersistenceConfig(config);

      expect(first).toEqual(second);
    });

    it('never includes the connection string secret in error messages', () => {
      const config = cloneConfig({ driver: 'mysql' });
      const result = validatePersistenceConfig(config);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain('super-secret');
      expect(serialized).not.toContain(VALID_CONFIG.persistence.connectionString);
    });
  });
});

const VALID_ALERTING_CONFIG = {
  alerting: {
    enabled: true,
    webhookUrl: 'https://hooks.example.com/services/secret-token-abc123',
    failureThreshold: 5,
    cooldownMs: 60000,
  },
};

function cloneAlertingConfig(overrides = {}) {
  return {
    ...VALID_ALERTING_CONFIG,
    alerting: { ...VALID_ALERTING_CONFIG.alerting, ...overrides },
  };
}

describe('event worker failure alerting configuration validation', () => {
  describe('success path', () => {
    it('accepts a fully specified, consistent alerting configuration', () => {
      expect(() => validateAlertingConfig(VALID_ALERTING_CONFIG)).not.toThrow();
      expect(validateAlertingConfig(VALID_ALERTING_CONFIG)).toEqual({ valid: true, errors: [] });
    });

    it('accepts a disabled alerting configuration without requiring a webhook URL', () => {
      const config = cloneAlertingConfig({ enabled: false, webhookUrl: undefined });
      expect(validateAlertingConfig(config)).toEqual({ valid: true, errors: [] });
    });
  });

  describe('failure paths', () => {
    it('rejects enabled alerting without a webhook URL', () => {
      const config = cloneAlertingConfig({ webhookUrl: '' });
      const result = validateAlertingConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'alerting.webhookUrl is required when alerting.enabled is true'
      );
    });

    it('rejects a webhook URL that is not a valid http(s) URL', () => {
      const config = cloneAlertingConfig({ webhookUrl: 'not-a-url' });
      const result = validateAlertingConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'alerting.webhookUrl must be a valid http(s) URL'
      );
    });

    it('rejects a non-positive failure threshold', () => {
      const config = cloneAlertingConfig({ failureThreshold: 0 });
      const result = validateAlertingConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'alerting.failureThreshold must be a positive integer'
      );
    });
  });

  describe('boundary paths', () => {
    it('rejects a negative cooldown interval', () => {
      const config = cloneAlertingConfig({ cooldownMs: -1 });
      const result = validateAlertingConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'alerting.cooldownMs must be a non-negative number'
      );
    });

    it('reports every problem at once rather than stopping at the first', () => {
      const config = cloneAlertingConfig({
        webhookUrl: 'not-a-url',
        failureThreshold: 0,
        cooldownMs: -1,
      });
      const result = validateAlertingConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('determinism and secret hygiene', () => {
    it('produces identical results across repeated invocations', () => {
      const config = cloneAlertingConfig({ webhookUrl: 'not-a-url' });
      const first = validateAlertingConfig(config);
      const second = validateAlertingConfig(config);

      expect(first).toEqual(second);
    });

    it('never includes the webhook URL secret in error messages', () => {
      const config = cloneAlertingConfig({ failureThreshold: 0 });
      const result = validateAlertingConfig(config);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain('secret-token-abc123');
      expect(serialized).not.toContain(VALID_ALERTING_CONFIG.alerting.webhookUrl);
    });
  });
});
