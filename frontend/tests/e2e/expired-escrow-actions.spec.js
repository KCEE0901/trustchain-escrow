import { expect, test } from '@playwright/test';

const CLIENT_ADDRESS = 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG';

function makeEscrow({ status, deadline }) {
  return {
    id: '275',
    title: 'Browser Test Escrow',
    status,
    deadline,
    clientAddress: CLIENT_ADDRESS,
    freelancerAddress: 'GABCD...1234',
    totalAmount: '1,000 USDC',
    remainingBalance: '1,000 USDC',
    createdAt: '2026-01-01T00:00:00.000Z',
    milestones: [
      {
        id: 0,
        title: 'Review deliverables',
        amount: '1,000 USDC',
        status: 'Submitted',
        submittedAt: '2026-01-02T00:00:00.000Z',
      },
    ],
  };
}

async function seedEscrow(page, escrow) {
  await page.addInitScript((address) => {
    localStorage.setItem(
      'ste-app-store',
      JSON.stringify({
        wallet: { address, isConnected: true, network: 'testnet' },
        admin: { apiKey: null },
      }),
    );
  }, CLIENT_ADDRESS);

  await page.route('**/api/escrows/275', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(escrow),
    }),
  );

  await page.goto('/escrow/275');
}

test('active escrow shows a live countdown and keeps valid actions enabled', async ({ page }) => {
  await seedEscrow(
    page,
    makeEscrow({
      status: 'Active',
      deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  );

  await expect(page.getByTestId('escrow-countdown')).toContainText('Time remaining:');
  await expect(page.getByRole('button', { name: /Raise Dispute/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancel Escrow' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Approve/ })).toBeEnabled();
});

test('expired escrow explains the state and disables invalid actions', async ({ page }) => {
  await seedEscrow(
    page,
    makeEscrow({
      status: 'Expired',
      deadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }),
  );

  await expect(page.getByTestId('escrow-countdown')).toHaveText('Expired');
  await expect(page.getByTestId('expired-escrow-message')).toContainText(
    'Disputes, cancellation, and milestone actions are disabled',
  );
  await expect(page.getByRole('button', { name: /Raise Dispute/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel Escrow' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Approve/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Reject/ })).toBeDisabled();
});
