import { jest } from '@jest/globals';

const auditServiceMock = {
  search: jest.fn(),
  exportCsv: jest.fn(),
  getStats: jest.fn(),
};

const auditVerifierMock = {
  verifyLogEntry: jest.fn(),
};

jest.unstable_mockModule('../services/auditService.js', () => ({
  default: auditServiceMock,
}));

jest.unstable_mockModule('../services/auditVerifier.js', () => ({
  default: auditVerifierMock,
}));

const { default: auditController } = await import('../api/controllers/auditController.js');

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status: jest.fn().mockImplementation(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn().mockImplementation(function (payload) {
      this.body = payload;
      return this;
    }),
    setHeader: jest.fn().mockImplementation(function (key, val) {
      this.headers[key] = val;
      return this;
    }),
    send: jest.fn().mockImplementation(function (payload) {
      this.body = payload;
      return this;
    }),
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('auditController', () => {
  it('searches audit logs with query params', async () => {
    const req = { query: { category: 'escrow', page: '1' } };
    const res = createMockRes();
    auditServiceMock.search.mockResolvedValue({ items: [], total: 0 });

    await auditController.searchAuditLogs(req, res);

    expect(auditServiceMock.search).toHaveBeenCalledWith(req.query);
    expect(res.json).toHaveBeenCalledWith({ items: [], total: 0 });
  });

  it('exports audit logs as CSV', async () => {
    const req = { query: { category: 'payment' } };
    const res = createMockRes();
    auditServiceMock.exportCsv.mockResolvedValue('header1,header2\nval1,val2');

    await auditController.exportAuditLogs(req, res);

    expect(auditServiceMock.exportCsv).toHaveBeenCalledWith(req.query);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(res.send).toHaveBeenCalledWith('header1,header2\nval1,val2');
  });

  it('retrieves audit stats', async () => {
    const req = {};
    const res = createMockRes();
    auditServiceMock.getStats.mockResolvedValue({ totalEvents: 42 });

    await auditController.getAuditStats(req, res);

    expect(auditServiceMock.getStats).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ totalEvents: 42 });
  });

  it('verifies audit log entry integrity', async () => {
    const req = { params: { logId: 'log-123' } };
    const res = createMockRes();
    auditVerifierMock.verifyLogEntry.mockResolvedValue({ verified: true });

    await auditController.verifyAuditLogIntegrity(req, res);

    expect(auditVerifierMock.verifyLogEntry).toHaveBeenCalledWith('log-123');
    expect(res.json).toHaveBeenCalledWith({ verified: true });
  });
});
