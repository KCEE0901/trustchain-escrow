import { expect, test } from '@playwright/test';

const MOCK_ADDRESS = 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG';

async function seedWalletAuth(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((addr) => {
    localStorage.setItem(
      'ste-app-store',
      JSON.stringify({
        wallet: { address: addr, isConnected: true, network: 'testnet' },
        admin: { apiKey: null },
      }),
    );
  }, MOCK_ADDRESS);
}

test.describe('visual regression', () => {
  test('landing page matches the approved baseline', async ({ page }) => {
    test.skip(
      test.info().project.name !== 'chromium',
      'Visual baselines are maintained for Chromium.',
    );

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toMatchSnapshot('home-page.png');
  });

  test('create escrow page matches the approved baseline', async ({ page }) => {
    test.skip(
      test.info().project.name !== 'chromium',
      'Visual baselines are maintained for Chromium.',
    );

    await seedWalletAuth(page);
    await page.goto('/escrow/create', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Create New Escrow' })).toBeVisible();
    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toMatchSnapshot('create-escrow-page.png');
  });

  test('metadata upload success matches the approved baseline', async ({ page }) => {
    test.skip(
      test.info().project.name !== 'chromium',
      'Visual baselines are maintained for Chromium.',
    );
    await page.route('**/api/ipfs/upload', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"cid":"bafy-demo"}' }),
    );
    await seedWalletAuth(page);
    await page.goto('/escrow/create', { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/Project Brief/).fill('Website design and delivery requirements');
    await page.getByRole('button', { name: 'Upload metadata to IPFS' }).click();
    await expect(page.getByText('Metadata uploaded successfully.')).toBeVisible();

    const uploadRegion = page.getByRole('button', { name: 'Upload metadata to IPFS' }).locator('..');
    expect(await uploadRegion.screenshot()).toMatchSnapshot('metadata-upload-success.png');
  });
});
