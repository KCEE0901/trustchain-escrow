import TenantFreshnessControl from './TenantFreshnessControl';
export default { title: 'Tenant/FreshnessControl', component: TenantFreshnessControl };
export const Current = { args: { role: 'tenant_admin', stale: false, initialConfig: {}, onRefresh: async () => ({}) } };
export const Stale = { args: { ...Current.args, stale: true } };
export const ReducedMotion = { args: { ...Stale.args, reducedMotion: true } };
