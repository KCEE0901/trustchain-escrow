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

export async function index(_req, res) {
  const flags = await listFlags();
  res.json({ data: flags });
}

export async function create(req, res) {
  try {
    const flag = await createFlag(req.body, req.headers['x-admin-api-key']);
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
    const flag = await updateFlag(req.params.key, req.body, req.headers['x-admin-api-key']);
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
    await deleteFlag(req.params.key, req.headers['x-admin-api-key']);
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

    await setTenantFlagOverride(key, tenantId, isEnabled, req.headers['x-admin-api-key']);
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
    await removeTenantFlagOverride(key, tenantId, req.headers['x-admin-api-key']);
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
