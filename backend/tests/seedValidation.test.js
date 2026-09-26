import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  validateEnvironment,
  validateSeedRecords,
  runSeed,
} from '../database/seed/index.js';
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_SLUG,
  TENANTS,
  USERS,
  FEATURE_FLAGS,
  ESCROWS,
} from '../database/seed/data.js';

describe('Database Seed Validation (#201)', () => {
  describe('validateEnvironment', () => {
    it('succeeds for valid development and test environments', () => {
      const devEnv = {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/trustchain_dev',
      };
      expect(() => validateEnvironment(devEnv)).not.toThrow();

      const testEnv = {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/trustchain_test',
      };
      expect(() => validateEnvironment(testEnv)).not.toThrow();
    });

    it('rejects execution when NODE_ENV is production', () => {
      const prodEnv = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/trustchain_dev',
      };
      expect(() => validateEnvironment(prodEnv)).toThrow(
        /Refusing to seed database in production environment/i,
      );
    });

    it('rejects execution when APP_ENV is production', () => {
      const prodEnv = {
        NODE_ENV: 'development',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/trustchain_dev',
      };
      expect(() => validateEnvironment(prodEnv)).toThrow(
        /Refusing to seed database in production environment/i,
      );
    });

    it('rejects execution when DATABASE_URL is missing', () => {
      const noDbEnv = {
        NODE_ENV: 'development',
      };
      expect(() => validateEnvironment(noDbEnv)).toThrow(
        /DATABASE_URL environment variable is missing/i,
      );
    });

    it('rejects execution when DATABASE_URL points to a production host', () => {
      const prodDbEnv = {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://admin:secret@prod.stellar-escrow.internal:5432/main',
      };
      expect(() => validateEnvironment(prodDbEnv)).toThrow(
        /DATABASE_URL appears to target a production database host/i,
      );
    });
  });

  describe('validateSeedRecords', () => {
    let mockPrisma;

    beforeEach(() => {
      mockPrisma = {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({ id: DEFAULT_TENANT_ID, slug: DEFAULT_TENANT_SLUG }),
        },
        user: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            email: 'admin@example.com',
            role: 'admin',
            tenantId: DEFAULT_TENANT_ID,
          }),
        },
        featureFlag: {
          findMany: jest.fn().mockResolvedValue(FEATURE_FLAGS),
        },
        escrow: {
          findMany: jest.fn().mockResolvedValue(ESCROWS),
        },
      };
    });

    it('succeeds when all required records exist', async () => {
      const summary = await validateSeedRecords(mockPrisma);
      expect(summary.tenantId).toBe(DEFAULT_TENANT_ID);
      expect(summary.adminEmail).toBe('admin@example.com');
      expect(summary.flagsCount).toBeGreaterThanOrEqual(FEATURE_FLAGS.length);
      expect(summary.escrowsCount).toBeGreaterThanOrEqual(ESCROWS.length);
    });

    it('throws error if required default tenant is missing', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);
      await expect(validateSeedRecords(mockPrisma)).rejects.toThrow(
        /Default tenant "default" not found/i,
      );
    });

    it('throws error if required admin user is missing', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(validateSeedRecords(mockPrisma)).rejects.toThrow(
        /Required admin user not found/i,
      );
    });

    it('throws error if feature flags are missing', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await expect(validateSeedRecords(mockPrisma)).rejects.toThrow(
        /Expected at least \d+ feature flags/i,
      );
    });

    it('throws error if sample escrows are missing', async () => {
      mockPrisma.escrow.findMany.mockResolvedValue([]);
      await expect(validateSeedRecords(mockPrisma)).rejects.toThrow(
        /Expected at least \d+ sample escrows/i,
      );
    });
  });

  describe('runSeed idempotency', () => {
    it('is idempotent across multiple runs using upsert operations', async () => {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/trustchain_test';

      const mockPrisma = {
        tenant: {
          upsert: jest.fn().mockResolvedValue({ id: DEFAULT_TENANT_ID }),
          findUnique: jest.fn().mockResolvedValue({ id: DEFAULT_TENANT_ID, slug: DEFAULT_TENANT_SLUG }),
        },
        user: {
          upsert: jest.fn().mockResolvedValue({ id: 1, role: 'admin' }),
          findFirst: jest.fn().mockResolvedValue({ id: 1, role: 'admin', email: 'admin@example.com' }),
        },
        featureFlag: {
          upsert: jest.fn().mockResolvedValue({ key: 'dispute_appeals' }),
          findMany: jest.fn().mockResolvedValue(FEATURE_FLAGS),
        },
        escrow: {
          upsert: jest.fn().mockResolvedValue({ id: BigInt(1) }),
          findMany: jest.fn().mockResolvedValue(ESCROWS),
        },
        milestone: {
          upsert: jest.fn().mockResolvedValue({ id: 1 }),
        },
        reputationRecord: {
          upsert: jest.fn().mockResolvedValue({ id: 1 }),
        },
      };

      // Run 1
      const summary1 = await runSeed({ client: mockPrisma });
      expect(summary1.adminEmail).toBe('admin@example.com');
      expect(mockPrisma.tenant.upsert).toHaveBeenCalledTimes(TENANTS.length);
      expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(USERS.length);
      expect(mockPrisma.featureFlag.upsert).toHaveBeenCalledTimes(FEATURE_FLAGS.length);
      expect(mockPrisma.escrow.upsert).toHaveBeenCalledTimes(ESCROWS.length);

      // Run 2 (verify idempotency: upserts succeed without schema violations)
      const summary2 = await runSeed({ client: mockPrisma });
      expect(summary2.adminEmail).toBe('admin@example.com');
      expect(mockPrisma.tenant.upsert).toHaveBeenCalledTimes(TENANTS.length * 2);
    });
  });
});
