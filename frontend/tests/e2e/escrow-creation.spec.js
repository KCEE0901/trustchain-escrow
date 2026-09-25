import { test, expect } from '@playwright/test';

const MOCK_CLIENT_ADDRESS = 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG';
const MOCK_FREELANCER_ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWGS';

test.describe('Escrow Creation Wizard Flow', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Mock Freighter wallet API globally on window object before navigation
    await page.addInitScript((mockAddress) => {
      window.freighterApi = {
        isConnected: async () => true,
        isAllowed: async () => true,
        getUserInfo: async () => ({ publicKey: mockAddress }),
        getPublicKey: async () => mockAddress,
        signTransaction: async () => ({
          signedTxXdr: 'AAAA_MOCK_SIGNED_XDR_FOR_PLAYWRIGHT_TEST',
          signedXDR: 'AAAA_MOCK_SIGNED_XDR_FOR_PLAYWRIGHT_TEST',
        }),
        signAuthEntry: async () => ({}),
        getNetwork: async () => 'TESTNET',
      };
    }, MOCK_CLIENT_ADDRESS);

    // 2. Pre-seed wallet in localStorage for route guards & state provider
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((addr) => {
      localStorage.setItem(
        'ste-app-store',
        JSON.stringify({
          wallet: { address: addr, isConnected: true, network: 'testnet' },
          admin: { apiKey: null },
        }),
      );
    }, MOCK_CLIENT_ADDRESS);

    // 3. Mock backend API responses for escrow broadcast and fetch
    await page.route('**/api/escrows/broadcast', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          id: 'escrow-test-123',
          escrowId: 'escrow-test-123',
          txHash: '0x1234567890abcdef1234567890abcdef',
        }),
      });
    });

    await page.route('**/api/v1/escrows/broadcast', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          id: 'escrow-test-123',
          escrowId: 'escrow-test-123',
          txHash: '0x1234567890abcdef1234567890abcdef',
        }),
      });
    });

    await page.route('**/api/escrows/escrow-test-123*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'escrow-test-123',
          status: 'Active',
          clientAddress: MOCK_CLIENT_ADDRESS,
          freelancerAddress: MOCK_FREELANCER_ADDRESS,
          totalAmount: '500',
          tokenAddress: 'USDC',
          milestones: [
            {
              id: 'm1',
              title: 'Milestone 1: Deliver MVP',
              amount: '500',
              status: 'Pending',
            },
          ],
        }),
      });
    });
  });

  test('happy path: walks through all creation wizard steps, submits, and redirects to escrow detail', async ({
    page,
  }) => {
    // Navigate to escrow creation page
    await page.goto('/escrow/create', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/escrow\/create$/);
    await expect(page.getByRole('heading', { name: 'Create New Escrow' })).toBeVisible();

    // Step 1: Counterparty & Funds
    await expect(
      page.getByRole('heading', { level: 2, name: 'Counterparty & Funds' }),
    ).toBeVisible();
    await page.fill('input#freelancer-address', MOCK_FREELANCER_ADDRESS);
    await page.fill('input#total-amount', '500');
    await page.fill(
      'textarea#brief-description',
      'End-to-end development of the smart escrow platform',
    );

    // Advance to Step 2
    await page.click('button:has-text("Next →")');

    // Step 2: Milestones
    await expect(page.getByRole('heading', { level: 2, name: 'Milestones' })).toBeVisible();
    await page.fill('input[placeholder*="Title"]', 'Milestone 1: Deliver MVP');
    await page.fill(
      'textarea[placeholder*="description"]',
      'Deliver core contracts and web interface',
    );
    await page.fill('input[aria-label="Milestone 1 amount"]', '500');

    // Advance to Step 3
    await page.click('button:has-text("Next →")');

    // Step 3: Review Details
    await expect(page.getByRole('heading', { level: 2, name: 'Review Details' })).toBeVisible();
    await expect(page.locator('text=Freelancer:')).toBeVisible();
    await expect(page.locator(`text=${MOCK_FREELANCER_ADDRESS}`)).toBeVisible();

    // Advance to Step 4
    await page.click('button:has-text("Next →")');

    // Step 4: Sign & Submit
    await expect(page.getByRole('heading', { level: 2, name: 'Sign & Submit' })).toBeVisible();
    const signButton = page.getByRole('button', { name: /Sign & Create Escrow/i });
    await expect(signButton).toBeVisible();

    // Submit form and verify success redirect
    await signButton.click();
    await page.waitForURL(/\/escrow\/escrow-test-123/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/escrow\/escrow-test-123/);
  });

  test('validation failure path: shows error and halts submission when amount is empty', async ({
    page,
  }) => {
    // Navigate to escrow creation page
    await page.goto('/escrow/create', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Create New Escrow' })).toBeVisible();

    // Fill freelancer address but leave total amount empty
    await page.fill('input#freelancer-address', MOCK_FREELANCER_ADDRESS);
    const amountInput = page.locator('input#total-amount');
    await amountInput.fill('');
    await amountInput.blur();

    // Step 2
    await page.click('button:has-text("Next →")');
    await expect(page.getByRole('heading', { level: 2, name: 'Milestones' })).toBeVisible();

    // Step 3
    await page.click('button:has-text("Next →")');
    await expect(page.getByRole('heading', { level: 2, name: 'Review Details' })).toBeVisible();

    // Step 4
    await page.click('button:has-text("Next →")');
    await expect(page.getByRole('heading', { level: 2, name: 'Sign & Submit' })).toBeVisible();

    // Click submit with empty amount
    const signButton = page.getByRole('button', { name: /Sign & Create Escrow/i });
    await signButton.click();

    // Verify error alert is rendered and no navigation occurs
    const errorAlert = page.locator('[role="alert"], .text-red-400');
    await expect(errorAlert.first()).toBeVisible();
    await expect(errorAlert.first()).toContainText(/amount/i);
    await expect(page).toHaveURL(/\/escrow\/create$/);
  });
});
