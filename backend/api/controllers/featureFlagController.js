import {
  listFlags,
  createFlag,
  updateFlag,
  deleteFlag,
  listFlagsForTenant,
  setTenantFlagOverride,
  removeTenantFlagOverride,
} from '../../services/featureFlags.js';

export async function index(_req, res) {
  const flags = await listFlags();
  res.json({ data: flags });
}

export async function create(req, res) {
  try {
    const flag = await createFlag(req.body, req.headers['x-admin-api-key']);
    res.status(201).json({ data: flag });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Flag key already exists.' });
    res.status(400).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const flag = await updateFlag(req.params.key, req.body, req.headers['x-admin-api-key']);
    res.json({ data: flag });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Flag not found.' });
    res.status(400).json({ error: err.message });
  }
}

export async function destroy(req, res) {
  try {
    await deleteFlag(req.params.key, req.headers['x-admin-api-key']);
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Flag not found.' });
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
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'isEnabled must be a boolean' } });
    }

    await setTenantFlagOverride(key, tenantId, isEnabled, req.headers['x-admin-api-key']);
    res.json({ ok: true, flagKey: key, tenantId, isEnabled });
  } catch (err) {
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
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}
