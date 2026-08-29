import { jest } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────

const prismaMock = {
  escrow: {
    findUnique: jest.fn(),
  },
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../services/escrowRealtime.js', () => ({
  escrowTopic: (id) => `escrow:${id}`,
  broadcastEscrowUpdate: jest.fn(),
}));

const { default: streamController } = await import('../api/controllers/streamController.js');

// ── Helpers ───────────────────────────────────────────────────────────────

function createRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────

describe('streamController.getEscrowStream — end to end happy path', () => {
  it('resolves the realtime topic for an existing escrow', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue({
      id: 42n,
      status: 'Funded',
    });

    const req = { params: { escrowId: '42' } };
    const res = createRes();

    await streamController.getEscrowStream(req, res);

    expect(prismaMock.escrow.findUnique).toHaveBeenCalledWith({ where: { id: 42n } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      escrowId: '42',
      topic: 'escrow:42',
      status: 'Funded',
    });
  });

  it('returns 404 when the escrow does not exist', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(null);

    const req = { params: { escrowId: '999' } };
    const res = createRes();

    await streamController.getEscrowStream(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Escrow not found' });
  });

  it('returns 400 for a non-numeric escrowId', async () => {
    const req = { params: { escrowId: 'not-a-number' } };
    const res = createRes();

    await streamController.getEscrowStream(req, res);

    expect(res.statusCode).toBe(400);
    expect(prismaMock.escrow.findUnique).not.toHaveBeenCalled();
  });
});
