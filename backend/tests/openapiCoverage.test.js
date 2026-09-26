/**
 * OpenAPI coverage — every Express route must be documented under
 * api/docs/paths or listed in tests/fixtures/openapiCoverageExcludes.json.
 *
 * Adding a new route without docs fails this test. Only add to the excludes
 * file for intentional omissions (infrastructure/internal endpoints) or
 * pre-existing gaps; remove entries once they are documented.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  collectDocumentedRoutes,
  collectRegisteredRoutes,
  findUndocumentedRoutes,
  normalizePath,
  parseMounts,
  parseRouterSource,
} from '../scripts/openapiCoverage.js';

const excludes = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'fixtures',
      'openapiCoverageExcludes.json',
    ),
    'utf8',
  ),
);

describe('OpenAPI route coverage', () => {
  const registered = collectRegisteredRoutes();
  const documented = collectDocumentedRoutes();

  it('discovers registered and documented routes', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(documented.size).toBeGreaterThan(0);
  });

  it('documents every registered route that is not intentionally excluded', () => {
    const missing = findUndocumentedRoutes(registered, documented, excludes);
    if (missing.length > 0) {
      throw new Error(
        `Undocumented routes (add them to api/docs/paths):\n  ${missing.join('\n  ')}`,
      );
    }
  });

  it('has no stale excludes', () => {
    const registeredKeys = new Set(registered.map((r) => `${r.method.toUpperCase()} ${r.path}`));
    const stale = excludes.filter((e) => documented.has(e) || !registeredKeys.has(e));
    expect(stale).toEqual([]);
  });
});

describe('OpenAPI coverage helpers', () => {
  it('normalizes Express params to OpenAPI form', () => {
    expect(normalizePath('/api/escrows/:id/milestones/:milestoneId/')).toBe(
      '/api/escrows/{id}/milestones/{milestoneId}',
    );
    expect(normalizePath('/api/health//')).toBe('/api/health');
  });

  it('parses single and multi-line router registrations', () => {
    const src = "router.get('/', h);\nrouter.post(\n  '/:id/evidence',\n  h,\n);";
    expect(parseRouterSource(src)).toEqual([
      { method: 'get', path: '/' },
      { method: 'post', path: '/:id/evidence' },
    ]);
  });

  it('maps server mounts to route modules', () => {
    const src =
      "import fooRoutes from './api/routes/fooRoutes.js';\napp.use('/api/foo', fooRoutes);\napp.use('/api', tenantMiddleware);";
    expect(parseMounts(src)).toEqual([{ prefix: '/api/foo', file: 'fooRoutes.js' }]);
  });

  it('reports a new undocumented route and honours excludes', () => {
    const routes = [
      { method: 'get', path: '/api/foo' },
      { method: 'post', path: '/api/foo/{id}' },
      { method: 'delete', path: '/api/foo/{id}' },
    ];
    const docs = new Set(['GET /api/foo']);
    expect(findUndocumentedRoutes(routes, docs, ['DELETE /api/foo/{id}'])).toEqual([
      'POST /api/foo/{id}',
    ]);
  });
});
