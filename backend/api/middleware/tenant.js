import prisma from '../../lib/prisma.js';
import { DEFAULT_TENANT_SLUG, runWithTenantContext } from '../../lib/tenantContext.js';


// A precedence list must include each supported selector once. If more than one
// header is supplied, one deterministic order is used instead of a database OR.
export function validateTenantResolutionConfiguration(env = process.env) {
  const raw = env.TENANT_RESOLUTION_PRECEDENCE ?? 'id,slug,host';
  const precedence = raw.split(',').map((part) => part.trim());
  if (precedence.length !== 3 || new Set(precedence).size !== 3 ||
      precedence.some((key) => !['id', 'slug', 'host'].includes(key))) {
    throw new Error('TENANT_RESOLUTION_PRECEDENCE must contain id,slug,host exactly once each');
  }
  const fallback = env.ALLOW_DEFAULT_TENANT_FALLBACK;
  if (fallback !== undefined && !['true', 'false'].includes(fallback)) {
    throw new Error('ALLOW_DEFAULT_TENANT_FALLBACK must be true or false');
  }
  return { precedence };
}

export function isDefaultTenantFallbackAllowed() {
  validateTenantResolutionConfiguration();
  if (process.env.ALLOW_DEFAULT_TENANT_FALLBACK !== undefined) {
    return process.env.ALLOW_DEFAULT_TENANT_FALLBACK === 'true';
  }
  return process.env.NODE_ENV !== 'production';
}

function extractHostname(req) {
  const forwardedHost = req.headers['x-forwarded-host'];
  const rawHost = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req.headers.host;

  if (!rawHost) return null;

  return rawHost.split(',')[0].trim().split(':')[0].toLowerCase();
}

async function findTenant(req) {
  const { precedence } = validateTenantResolutionConfiguration();
  const tenantId = req.headers['x-tenant-id'];
  const tenantSlug = req.headers['x-tenant-slug'];
  const hostname = extractHostname(req);
  const candidates = {
    id: typeof tenantId === 'string' && tenantId.trim() ? { id: tenantId.trim() } : null,
    slug: typeof tenantSlug === 'string' && tenantSlug.trim()
      ? { slug: tenantSlug.trim().toLowerCase() } : null,
    host: hostname && hostname !== 'localhost' && hostname !== '127.0.0.1'
      ? { domains: { has: hostname } } : null,
  };
  const select = {
    id: true, slug: true, name: true, status: true, domains: true,
    branding: true, configuration: true, metadata: true,
    createdAt: true, updatedAt: true,
  };
  for (const source of precedence) {
    if (!candidates[source]) continue;
    // An explicit higher-priority selector must not silently degrade to a lower one.
    return prisma.tenant.findFirst({ where: candidates[source], select });
  }
  if (!isDefaultTenantFallbackAllowed()) return undefined;
  return prisma.tenant.findFirst({
    where: { slug: DEFAULT_TENANT_SLUG }, select,
  });
}

export default async function tenantMiddleware(req, res, next) {
  try {
    const tenant = await findTenant(req);

    if (tenant === undefined) {
      return res.status(400).json({ error: 'Tenant identifier required' });
    }

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    if (tenant.status !== 'active') {
      return res.status(403).json({ error: 'Tenant is not active' });
    }

    req.tenant = tenant;
    res.locals.tenant = tenant;
    res.setHeader('X-Tenant-Slug', tenant.slug);

    return runWithTenantContext(tenant, () => next());
  } catch (err) {
    return next(err);
  }
}
