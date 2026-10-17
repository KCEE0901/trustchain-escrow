'use client';

import { useState } from 'react';

export function canRefreshTenant({ role, stale, pending }) {
  return stale && !pending && ['admin', 'tenant_admin'].includes(role);
}

export default function TenantFreshnessControl({ role, initialConfig, stale, onRefresh, reducedMotion = false }) {
  const [config, setConfig] = useState(initialConfig);
  const [pending, setPending] = useState(false);
  const allowed = canRefreshTenant({ role, stale, pending });
  async function refresh() {
    const snapshot = config; setPending(true); setConfig({ ...config, freshness: 'refreshing' });
    try { setConfig(await onRefresh()); } catch { setConfig(snapshot); } finally { setPending(false); }
  }
  return <section className={reducedMotion ? 'transition-none' : 'transition-opacity duration-200'} aria-labelledby="tenant-freshness-title">
    <h2 id="tenant-freshness-title">Tenant configuration</h2>
    <p aria-live="polite">{pending ? 'Refreshing configuration' : stale ? 'Configuration is stale' : 'Configuration is current'}</p>
    <button type="button" disabled={!allowed} aria-disabled={!allowed} onClick={refresh}>Refresh configuration</button>
  </section>;
}
