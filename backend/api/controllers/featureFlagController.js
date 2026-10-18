import {
  listFlags,
  createFlag,
  updateFlag,
  deleteFlag,
  listFlagsForTenant,
  setTenantFlagOverride,
  removeTenantFlagOverride,
} from '../../services/featureFlags.js';

const TELEMETRY_PREFIX = '[admin.feature-flags]';

// Idempotency safeguards for dynamic admin settings persistence.
// Retries and concurrent requests carrying the same idempotency key must not
// apply the same effect twice. We keep a bounded in-memory record of recently
// seen keys keyed by a deterministic fingerprint of the request.
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 1000;
const idempotencyStore = new Map();

function emitTelemetry(event, fields = {}) {
  const payload = { event, ...fields };
  try {
    console.info(TELEMETRY_PREFIX, JSON.stringify(payload));
  } catch {
    console.info(TELEMETRY_PREFIX, event);
  }
}

function errorCode(err) {
  return (err && typeof err.code === 'string' && err.code) || 'UNKNOWN';
}

function pruneIdempotencyStore(now) {
  for (const [key, entry] of idempotencyStore) {
    if (entry.expiresAt <= now) {
      idempotencyStore.delete(key);
    }
  }
  while (idempotencyStore.size > IDEMPOTENCY_MAX_ENTRIES) {
    const oldest = idempotencyStore.keys().next().value;
    idempotencyStore.delete(oldest);
  }
}

function idempotencyKeyFor(req, scope) {
  const headerKey = req.headers['idempotency-key'];
  if (typeof headerKey !== 'string' || headerKey.trim() === '') {
    return null;
  }
  return `${scope}:${headerKey.trim()}`;
}

/**
 * Run `handler` at most once per idempotency key. Concurrent callers with the
 * same key share the in-flight promise; completed results are replayed for the
 * TTL window so retries observe the original outcome instead of re-applying it.
 */
async function withIdempotency(req, scope, handler) {
  const key = idempotencyKeyFor(req, scope);
  if (!key) {
    return handler();
  }

  const now = Date.now();
  pruneIdempotencyStore(now);

  const existing = idempotencyStore.get(key);
  if (existing) {
    emitTelemetry('idempotency.replay', { scope });
    return existing.promise;
  }

  const entry = { expiresAt: now + IDEMPOTENCY_TTL_MS, promise: null };
  entry.promise = (async () => {
    try {
      return await handler();
    } catch (err) {
      // Failed attempts must not be replayed; allow a retry to re-run.
      idempotencyStore.delete(key);
      throw err;
    }
  })();
  idempotencyStore.set(key, entry);
  return entry.promise;
}

export async function index(_req, res) {
  const flags = await listFlags();
  res.json({ data: flags });
}

export async function create(req, res) {
  try {
    const flag = await withIdempotency(req, 'create', () =>
      createFlag(req.body, req.headers['x-admin-api-key']),
    );
    emitTelemetry('create.success', { flagKey: flag?.key ?? null });
    res.status(201).json({ data: flag });
  } catch (err) {
    if (err.code === 'P2002') {
      emitTelemetry('create.conflict', { errorCode: errorCode(err) });
      return res.status(409).json({ error: 'Flag key already exists.' });
    }
    emitTelemetry('create.failure', { errorCode: errorCode(err) });
    res.status(400).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const flag = await withIdempotency(req, `update:${req.params.key}`, () =>
      updateFlag(req.params.key, req.body, req.headers['x-admin-api-key']),
    );
    emitTelemetry('update.success', { flagKey: req.params.key });
    res.json({ data: flag });
  } catch (err) {
    if (err.code === 'P2025') {
      emitTelemetry('update.not_found', { flagKey: req.params.key, errorCode: errorCode(err) });
      return res.status(404).json({ error: 'Flag not found.' });
    }
    emitTelemetry('update.failure', { flagKey: req.params.key, errorCode: errorCode(err) });
    res.status(400).json({ error: err.message });
  }
}

export async function destroy(req, res) {
  try {
    await withIdempotency(req, `delete:${req.params.key}`, () =>
      deleteFlag(req.params.key, req.headers['x-admin-api-key']),
    );
    emitTelemetry('delete.success', { flagKey: req.params.key });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') {
      emitTelemetry('delete.not_found', { flagKey: req.params.key, errorCode: errorCode(err) });
      return res.status(404).json({ error: 'Flag not found.' });
    }
    emitTelemetry('delete.failure', { flagKey: req.params.key, errorCode: errorCode(err) });
    res.status(400).json({ error: err.message });
  }
}

/**
 * GET /api/admin/feature-flags/tenants/:tenantId
 * List all flags for a specific tenant, merged with global flag values.
 */
export async function listForTenant(req, res) {
  try {
    const { tenantId } = req.params;
    const flags = await listFlagsForTenant(tenantId);
    res.json({ data: flags });
  } catch (err) {
    emitTelemetry('list_for_tenant.failure', { tenantId: req.params.tenantId, errorCode: errorCode(err) });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}

/**
 * PUT /api/admin/feature-flags/:key/tenants/:tenantId
 * Set a tenant-level override for a feature flag.
 * Body: { isEnabled: boolean }
 */
export async function setTenantOverride(req, res) {
  try {
    const { key, tenantId } = req.params;
    const { isEnabled } = req.body ?? {};

    if (typeof isEnabled !== 'boolean') {
      emitTelemetry('set_tenant_override.invalid_body', { flagKey: key, tenantId });
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'isEnabled must be a boolean' } });
    }

    await withIdempotency(req, `set_tenant_override:${key}:${tenantId}`, () =>
      setTenantFlagOverride(key, tenantId, isEnabled, req.headers['x-admin-api-key']),
    );
    emitTelemetry('set_tenant_override.success', { flagKey: key, tenantId, isEnabled });
    res.json({ ok: true, flagKey: key, tenantId, isEnabled });
  } catch (err) {
    emitTelemetry('set_tenant_override.failure', {
      flagKey: req.params.key,
      tenantId: req.params.tenantId,
      errorCode: errorCode(err),
    });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}

/**
 * DELETE /api/admin/feature-flags/:key/tenants/:tenantId
 * Remove a tenant-level override, reverting to global flag behaviour.
 */
export async function removeTenantOverride(req, res) {
  try {
    const { key, tenantId } = req.params;
    await withIdempotency(req, `remove_tenant_override:${key}:${tenantId}`, () =>
      removeTenantFlagOverride(key, tenantId, req.headers['x-admin-api-key']),
    );
    emitTelemetry('remove_tenant_override.success', { flagKey: key, tenantId });
    res.status(204).end();
  } catch (err) {
    emitTelemetry('remove_tenant_override.failure', {
      flagKey: req.params.key,
      tenantId: req.params.tenantId,
      errorCode: errorCode(err),
    });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}
