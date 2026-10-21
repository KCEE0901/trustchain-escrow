import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
const findFirst = jest.fn();
jest.unstable_mockModule('../lib/prisma.js', () => ({ default: { tenant: { findFirst } } }));
const { validateTenantResolutionConfiguration, default: middleware } = await import('../api/middleware/tenant.js');
const original = { ...process.env };
const active = (id) => ({ id, slug: id, status: 'active' });
function run(headers) {
  const req = { headers };
  const res = {
    locals: {}, status(code) { this.code = code; return this; },
    json(value) { this.result = value; return this; }, setHeader() {},
  };
  const next = jest.fn();
  return middleware(req, res, next).then(() => ({ req, res, next }));
}
describe('tenant resolution configuration (#442)', () => {
  beforeEach(() => {
    delete process.env.TENANT_RESOLUTION_PRECEDENCE;
    delete process.env.ALLOW_DEFAULT_TENANT_FALLBACK;
    findFirst.mockReset();
  });
  afterEach(() => {
    for (const name of ['TENANT_RESOLUTION_PRECEDENCE', 'ALLOW_DEFAULT_TENANT_FALLBACK']) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });
  test('rejects contradictory/invalid precedence lists with actionable names', () => {
    process.env.TENANT_RESOLUTION_PRECEDENCE = 'id,id,host';
    expect(() => validateTenantResolutionConfiguration()).toThrow(/TENANT_RESOLUTION_PRECEDENCE/);
    process.env.TENANT_RESOLUTION_PRECEDENCE = 'id,slug,invalid';
    expect(() => validateTenantResolutionConfiguration()).toThrow(/TENANT_RESOLUTION_PRECEDENCE/);
    process.env.TENANT_RESOLUTION_PRECEDENCE = 'slug,id,host';
    expect(validateTenantResolutionConfiguration().precedence).toEqual(['slug', 'id', 'host']);
  });
  test('rejects unrecognized boolean setting rather than silently changing fallback', () => {
    process.env.ALLOW_DEFAULT_TENANT_FALLBACK = 'maybe';
    expect(() => validateTenantResolutionConfiguration()).toThrow(/ALLOW_DEFAULT_TENANT_FALLBACK/);
  });
  test('uses configured precedence when multiple tenant selectors are present', async () => {
    process.env.TENANT_RESOLUTION_PRECEDENCE = 'slug,id,host';
    findFirst.mockResolvedValueOnce(active('slug-tenant'));
    const { req, next } = await run({ 'x-tenant-id': 'id-tenant', 'x-tenant-slug': 'slug-tenant' });
    expect(findFirst.mock.calls[0][0].where).toEqual({ slug: 'slug-tenant' });
    expect(req.tenant.id).toBe('slug-tenant');
    expect(next).toHaveBeenCalled();
  });
  test('never downgrades to a lower-priority selector after an explicit mismatch', async () => {
    findFirst.mockResolvedValueOnce(null);
    const { res } = await run({ 'x-tenant-id': 'missing', 'x-tenant-slug': 'slug-tenant' });
    expect(res.code).toBe(404);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
