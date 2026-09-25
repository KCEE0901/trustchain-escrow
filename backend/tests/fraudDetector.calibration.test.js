/**
 * Calibration tests for backend/services/fraudDetector.js
 */

import { jest } from '@jest/globals';
import { fraudCalibrationFixtures } from './fixtures/fraudCalibration.js';

const prismaMock = {
  session: { findFirst: jest.fn() },
  escrow: { count: jest.fn() },
  milestone: { count: jest.fn() },
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));

const { scoreEscrow } = await import('../services/fraudDetector.js');

function loadDbState({ escrow, db }) {
  prismaMock.session.findFirst.mockImplementation(async ({ where }) => ({
    ipAddress: where.address === escrow.clientAddress ? db.clientIp : db.freelancerIp,
  }));
  prismaMock.escrow.count.mockResolvedValue(db.pairCount);
  prismaMock.milestone.count.mockResolvedValue(db.milestoneCount);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fraudDetector calibration fixtures', () => {
  it.each(fraudCalibrationFixtures.map((f) => [f.name, f]))(
    '%s escrow scores within agreed bounds',
    async (_name, fixture) => {
      loadDbState(fixture);

      const { score, flagged } = await scoreEscrow(fixture.escrow);

      expect(score).toBeGreaterThanOrEqual(fixture.expected.min);
      expect(score).toBeLessThanOrEqual(fixture.expected.max);
      expect(flagged).toBe(fixture.expected.flagged);
    },
  );

  it('orders fixtures normal < suspicious < high-risk', async () => {
    const scores = [];
    for (const fixture of fraudCalibrationFixtures) {
      loadDbState(fixture);
      scores.push((await scoreEscrow(fixture.escrow)).score);
    }

    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });
});
