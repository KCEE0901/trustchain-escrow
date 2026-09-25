/**
 * OpenAPI route coverage helpers.
 *
 * Statically collects the method/path pairs registered on the Express app
 * (server.js mounts + api/routes/*.js) and compares them with the paths
 * documented under api/docs/paths, so undocumented endpoints are caught
 * without booting the server.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import swaggerJsdoc from 'swagger-jsdoc';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Convert an Express path (`/:id`) to OpenAPI form (`/{id}`) without a trailing slash. */
export const normalizePath = (p) =>
  p
    .replace(/\/+/g, '/')
    .replace(/:([A-Za-z0-9_]+)\??/g, '{$1}')
    .replace(/\/$/, '') || '/';

/** Extract `router.<method>('<path>'` registrations from a route module's source. */
export function parseRouterSource(source) {
  const re = new RegExp(`router\\.(${METHODS.join('|')})\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
  return [...source.matchAll(re)].map(([, method, routePath]) => ({ method, path: routePath }));
}

/** Map each `app.use('<prefix>', <router>)` in server.js to its route module file. */
export function parseMounts(serverSource) {
  const imports = new Map(
    [...serverSource.matchAll(/import\s+(\w+)\s+from\s+'\.\/api\/routes\/([^']+)'/g)].map(
      ([, name, file]) => [name, file],
    ),
  );
  return [...serverSource.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)]
    .filter(([, , name]) => imports.has(name))
    .map(([, prefix, name]) => ({ prefix, file: imports.get(name) }));
}

export function collectRegisteredRoutes(root = backendRoot) {
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const routes = [];
  for (const { prefix, file } of parseMounts(serverSource)) {
    const source = fs.readFileSync(path.join(root, 'api', 'routes', file), 'utf8');
    for (const r of parseRouterSource(source)) {
      routes.push({ method: r.method, path: normalizePath(`${prefix}/${r.path}`) });
    }
  }
  return routes;
}

export function collectDocumentedRoutes(root = backendRoot) {
  const spec = swaggerJsdoc({
    definition: { openapi: '3.0.0', info: { title: 'coverage', version: '0' } },
    apis: [path.join(root, 'api', 'docs', 'paths', '*.js')],
  });
  const documented = new Set();
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(ops)) {
      if (METHODS.includes(method)) documented.add(`${method.toUpperCase()} ${normalizePath(p)}`);
    }
  }
  return documented;
}

/** Return sorted `METHOD /path` strings registered but neither documented nor excluded. */
export function findUndocumentedRoutes(registered, documented, excludes = []) {
  const excluded = new Set(excludes);
  const missing = new Set();
  for (const { method, path: p } of registered) {
    const key = `${method.toUpperCase()} ${p}`;
    if (!documented.has(key) && !excluded.has(key)) missing.add(key);
  }
  return [...missing].sort();
}
