import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TenantFreshnessControl, { canRefreshTenant } from '../../components/tenant/TenantFreshnessControl';

test('enforces role and stale-state permissions', () => {
  expect(canRefreshTenant({ role: 'tenant_admin', stale: true, pending: false })).toBe(true);
  expect(canRefreshTenant({ role: 'viewer', stale: true, pending: false })).toBe(false);
});

test('rolls back failed optimistic refresh without motion', async () => {
  render(<TenantFreshnessControl role="tenant_admin" stale initialConfig={{ version: 1 }} reducedMotion onRefresh={async () => { throw new Error('failed'); }} />);
  const section = screen.getByRole('heading', { name: 'Tenant configuration' }).parentElement;
  expect(section).toHaveClass('transition-none');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh configuration' }));
  await waitFor(() => expect(screen.getByText('Configuration is stale')).toBeInTheDocument());
});
