/**
 * Calibration fixtures for services/fraudDetector.js.
 *
 * Each fixture describes an escrow plus the DB state the detector reads,
 * and the score range reviewers have agreed it should land in. If a change
 * to signal weights or checks moves a fixture outside its range, the
 * calibration test fails and the change must update these bounds explicitly.
 */

const HOUR_MS = 60 * 60 * 1000;
const createdAt = new Date('2026-01-01T00:00:00Z');

export const fraudCalibrationFixtures = [
  {
    name: 'normal',
    description: 'Distinct IPs, multi-day delivery, first-time pair, odd amount, milestones set',
    escrow: {
      id: 1n,
      clientAddress: 'GCLIENT_NORMAL',
      freelancerAddress: 'GFREELANCER_NORMAL',
      totalAmount: '12345678',
      createdAt,
      updatedAt: new Date(createdAt.getTime() + 72 * HOUR_MS),
    },
    db: { clientIp: '10.0.0.1', freelancerIp: '10.0.0.2', pairCount: 0, milestoneCount: 3 },
    expected: { min: 0, max: 10, flagged: false },
  },
  {
    name: 'suspicious',
    description: 'Rapid completion of a round amount with no milestones',
    escrow: {
      id: 2n,
      clientAddress: 'GCLIENT_SUS',
      freelancerAddress: 'GFREELANCER_SUS',
      totalAmount: '50000000',
      createdAt,
      updatedAt: new Date(createdAt.getTime() + 0.5 * HOUR_MS),
    },
    db: { clientIp: '10.0.0.3', freelancerIp: '10.0.0.4', pairCount: 1, milestoneCount: 0 },
    expected: { min: 25, max: 49, flagged: false },
  },
  {
    name: 'high-risk',
    description: 'Shared IP, repeated pair, rapid completion, round amount, no milestones',
    escrow: {
      id: 3n,
      clientAddress: 'GCLIENT_RISK',
      freelancerAddress: 'GFREELANCER_RISK',
      totalAmount: '100000000',
      createdAt,
      updatedAt: new Date(createdAt.getTime() + 0.25 * HOUR_MS),
    },
    db: { clientIp: '203.0.113.7', freelancerIp: '203.0.113.7', pairCount: 5, milestoneCount: 0 },
    expected: { min: 80, max: 100, flagged: true },
  },
];

export default fraudCalibrationFixtures;
