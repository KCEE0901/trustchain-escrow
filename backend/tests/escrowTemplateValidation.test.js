/**
 * Tests — Escrow Template Validation (Issue #204)
 *
 * Covers:
 *  - Valid full payload passes
 *  - Missing required fields each produce field-level errors
 *  - Invalid Stellar addresses rejected
 *  - Invalid token IDs rejected
 *  - Milestone amount sum mismatch rejected
 *  - Past deadline rejected
 *  - Malformed milestone entries rejected
 *  - clientAddress === freelancerAddress rejected
 */

import { jest, describe, it, expect } from '@jest/globals';

// ── Lightweight Express-style harness ─────────────────────────────────────────
// We invoke validateEscrowTemplate directly as middleware without spinning up
// an HTTP server — keeps tests fast and dependency-free.

function makeReqRes(body) {
  // express-validator reads from req.body
  const req = { body };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

const { validateEscrowTemplate } = await import(
  '../middleware/escrowTemplateValidation.js'
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Valid Stellar G-address (56 chars, base-32 uppercase). */
const ADDR_CLIENT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
const ADDR_FREELANCER = 'GBQYE2MLPX5STYBQ5BYSAA5DRQVJPKOBWQ6FZBPZGKZMWQ5XRRBHVOY';
const ADDR_ARBITER = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZL8RO4GDLQXCTBQQ4NBG';
const TOKEN_NATIVE = 'native';
const TOKEN_USDC = 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function validPayload() {
  return {
    clientAddress: ADDR_CLIENT,
    freelancerAddress: ADDR_FREELANCER,
    tokenId: TOKEN_USDC,
    totalAmount: '1500',
    deadline: new Date(Date.now() + 86400 * 30 * 1000).toISOString(), // 30 days ahead
    milestones: [
      { title: 'Design phase', amount: '500' },
      { title: 'Development phase', amount: '1000' },
    ],
  };
}

async function runValidation(body) {
  const { req, res } = makeReqRes(body);
  let calledNext = false;
  const next = () => { calledNext = true; };
  await validateEscrowTemplate(req, res, next);
  return { res, calledNext };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Escrow Template Validation (#204)', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────
  it('passes a fully valid payload', async () => {
    const { calledNext } = await runValidation(validPayload());
    expect(calledNext).toBe(true);
  });

  it('passes with native token and no deadline', async () => {
    const payload = validPayload();
    delete payload.deadline;
    payload.tokenId = TOKEN_NATIVE;
    const { calledNext } = await runValidation(payload);
    expect(calledNext).toBe(true);
  });

  it('passes with optional arbiterAddress present', async () => {
    const payload = { ...validPayload(), arbiterAddress: ADDR_ARBITER };
    const { calledNext } = await runValidation(payload);
    expect(calledNext).toBe(true);
  });

  // ── Address validation ──────────────────────────────────────────────────────
  it('rejects a missing clientAddress', async () => {
    const payload = validPayload();
    delete payload.clientAddress;
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.field === 'clientAddress')).toBe(true);
  });

  it('rejects an invalid clientAddress', async () => {
    const payload = { ...validPayload(), clientAddress: 'NOT_A_STELLAR_ADDRESS' };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.field === 'clientAddress')).toBe(true);
  });

  it('rejects when clientAddress equals freelancerAddress', async () => {
    const payload = { ...validPayload(), freelancerAddress: ADDR_CLIENT };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.field === 'freelancerAddress')).toBe(true);
  });

  it('rejects an invalid arbiterAddress when supplied', async () => {
    const payload = { ...validPayload(), arbiterAddress: 'bad-address' };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.field === 'arbiterAddress')).toBe(true);
  });

  // ── Token ID validation ─────────────────────────────────────────────────────
  it('rejects an invalid tokenId', async () => {
    const payload = { ...validPayload(), tokenId: 'INVALID_TOKEN' };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.field === 'tokenId')).toBe(true);
  });

  it('accepts a Soroban contract ID as tokenId', async () => {
    // C + 55 uppercase base-32 chars
    const payload = {
      ...validPayload(),
      tokenId: 'CBIELTK6YBZJU5UP2WWQEQ4YO3B5EPCPLBXHK3BUJF3FSQPC4YCQNBQJ',
    };
    const { calledNext } = await runValidation(payload);
    expect(calledNext).toBe(true);
  });

  // ── Deadline validation ─────────────────────────────────────────────────────
  it('rejects a past deadline', async () => {
    const payload = { ...validPayload(), deadline: '2020-01-01T00:00:00.000Z' };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.field === 'deadline')).toBe(true);
  });

  it('rejects a non-ISO-8601 deadline', async () => {
    const payload = { ...validPayload(), deadline: 'next-friday' };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.field === 'deadline')).toBe(true);
  });

  // ── Milestone validation ────────────────────────────────────────────────────
  it('rejects an empty milestones array', async () => {
    const payload = { ...validPayload(), milestones: [] };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.field === 'milestones')).toBe(true);
  });

  it('rejects a milestone with an empty title', async () => {
    const payload = {
      ...validPayload(),
      milestones: [{ title: '', amount: '1500' }],
    };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.field.includes('title'))).toBe(true);
  });

  it('rejects a milestone with a zero amount', async () => {
    const payload = {
      ...validPayload(),
      totalAmount: '0',
      milestones: [{ title: 'Phase 1', amount: '0' }],
    };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects when milestone amounts do not sum to totalAmount', async () => {
    const payload = {
      ...validPayload(),
      totalAmount: '1500',
      milestones: [
        { title: 'Phase 1', amount: '500' },
        { title: 'Phase 2', amount: '500' }, // sum = 1000, not 1500
      ],
    };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.message.includes('Sum of milestone amounts'))).toBe(true);
  });

  it('rejects more than 50 milestones', async () => {
    const payload = {
      ...validPayload(),
      totalAmount: '51',
      milestones: Array.from({ length: 51 }, (_, i) => ({
        title: `Milestone ${i + 1}`,
        amount: '1',
      })),
    };
    const { calledNext, res } = await runValidation(payload);
    expect(calledNext).toBe(false);
    const body = res.json.mock.calls[0][0];
    expect(body.details.some((d) => d.message.includes('exceed'))).toBe(true);
  });

  // ── Response shape ──────────────────────────────────────────────────────────
  it('returns { error, details } shape with field names on failure', async () => {
    const payload = { milestones: [] };
    const { res } = await runValidation(payload);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('error', 'Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
    body.details.forEach((d) => {
      expect(d).toHaveProperty('field');
      expect(d).toHaveProperty('message');
    });
  });
});
