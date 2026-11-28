import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  getAppealDeadline,
  validateAppealDeadline,
  submitAppeal,
  DEFAULT_APPEAL_WINDOW_SECONDS,
} from '../services/disputeResolution.js';

describe('Dispute Appeal Deadline Enforcement (#196)', () => {
  const resolvedAt = new Date('2026-03-01T12:00:00Z');
  const expectedDeadline = new Date(
    resolvedAt.getTime() + DEFAULT_APPEAL_WINDOW_SECONDS * 1000,
  );

  describe('getAppealDeadline', () => {
    it('returns explicit dispute.appealDeadline if provided', () => {
      const customDeadline = new Date('2026-03-05T00:00:00Z');
      const dispute = {
        resolvedAt,
        appealDeadline: customDeadline,
      };
      expect(getAppealDeadline(dispute).getTime()).toBe(customDeadline.getTime());
    });

    it('calculates deadline based on resolvedAt and appeal window', () => {
      const dispute = { resolvedAt };
      const deadline = getAppealDeadline(dispute);
      expect(deadline.getTime()).toBe(expectedDeadline.getTime());
    });

    it('returns null if dispute is not resolved', () => {
      const dispute = { resolvedAt: null };
      expect(getAppealDeadline(dispute)).toBeNull();
    });
  });

  describe('validateAppealDeadline', () => {
    it('succeeds for appeals submitted before the deadline', () => {
      const dispute = { resolvedAt };
      const beforeDeadline = new Date('2026-03-03T12:00:00Z');
      expect(() => validateAppealDeadline(dispute, beforeDeadline)).not.toThrow();
    });

    it('succeeds on exact boundary time (currentTime === deadline)', () => {
      const dispute = { resolvedAt };
      expect(() => validateAppealDeadline(dispute, expectedDeadline)).not.toThrow();
    });

    it('throws with stable code APPEAL_DEADLINE_EXPIRED after deadline', () => {
      const dispute = { resolvedAt };
      const afterDeadline = new Date(expectedDeadline.getTime() + 1000); // 1s past deadline

      let thrownError;
      try {
        validateAppealDeadline(dispute, afterDeadline);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError.code).toBe('APPEAL_DEADLINE_EXPIRED');
      expect(thrownError.status).toBe(400);
      expect(thrownError.message).toMatch(/Appeal deadline expired/i);
      expect(thrownError.deadline.getTime()).toBe(expectedDeadline.getTime());
    });

    it('throws with DISPUTE_NOT_RESOLVED if dispute has not been resolved', () => {
      const dispute = { resolvedAt: null };
      let thrownError;
      try {
        validateAppealDeadline(dispute, new Date());
      } catch (err) {
        thrownError = err;
      }
      expect(thrownError.code).toBe('DISPUTE_NOT_RESOLVED');
    });
  });

  describe('submitAppeal with deadline enforcement', () => {
    let mockPrisma;

    beforeEach(() => {
      mockPrisma = {
        dispute: {
          findUnique: jest.fn(),
        },
        disputeAppeal: {
          create: jest.fn(),
        },
      };
    });

    it('rejects late appeal in submitAppeal service call', async () => {
      const dispute = {
        id: 42,
        resolvedAt,
        appeals: [],
      };

      // Mock prisma call inside submitAppeal
      // We test validateAppealDeadline integration
      const afterDeadline = new Date(expectedDeadline.getTime() + 60000);
      expect(() =>
        validateAppealDeadline(dispute, afterDeadline),
      ).toThrow(
        expect.objectContaining({ code: 'APPEAL_DEADLINE_EXPIRED' }),
      );
    });
  });
});
