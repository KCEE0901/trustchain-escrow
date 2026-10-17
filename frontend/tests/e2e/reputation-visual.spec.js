// frontend/tests/e2e/reputation-visual.spec.js
const { test, expect } = require('@playwright/test');

/**
 * Visual regression coverage for reputation data fetching states.
 *
 * These tests capture stable responsive snapshots for the critical states of
 * the reputation fetching UI (loading, success, error) at mobile and desktop
 * breakpoints. All network responses are mocked deterministically and
 * animations/transitions are disabled so snapshots are reproducible.
 */

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

// Deterministic mock payloads. Keep these free of secrets and stable across runs.
const SUCCESS_PAYLOAD = {
  address: '0x0000000000000000000000000000000000000001',
  score: 87,
  level: 'trusted',
  totalRatings: 42,
  positiveRatings: 39,
  negativeRatings: 3,
  lastUpdated: '2024-01-01T00:00:00.000Z',
};

const ERROR_PAYLOAD = {
  error: 'Failed to fetch reputation data',
  code: 'REPUTATION_FETCH_FAILED',
};

/**
 * Injects a stylesheet that disables animations and transitions and forces
 * stable font rendering so screenshots are reproducible across runs.
 */
async function stabilizePage(page) {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      html {
        -webkit-font-smoothing: antialiased !important;
        -moz-osx-font-smoothing: grayscale !important;
        text-rendering: optimizeLegibility !important;
      }
    `,
  });
}

/**
 * Waits for fonts to be loaded and the page to settle before capturing.
 */
async function waitForStableRender(page) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

test.describe('Reputation fetching visual states', () => {
  test.beforeEach(async ({ page }) => {
    // Fail loudly on unexpected console errors to catch regressions early.
    page.on('pageerror', (err) => {
      throw new Error(`Unexpected page error: ${err.message}`);
    });
  });

  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('loading state', async ({ page }) => {
      // Delay the response so the loading state remains visible.
      await page.route('**/api/reputation/**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(SUCCESS_PAYLOAD),
        });
      });

      await page.goto('/reputation');
      await stabilizePage(page);

      const loadingIndicator = page.getByTestId('reputation-loading');
      await expect(loadingIndicator).toBeVisible();

      await waitForStableRender(page);
      await expect(page).toHaveScreenshot('reputation-loading-desktop.png', {
        fullPage: true,
        animations: 'disabled',
      });
    });

    test('success state', async ({ page }) => {
      await page.route('**/api/reputation/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(SUCCESS_PAYLOAD),
        });
      });

      await page.goto('/reputation');
      await stabilizePage(page);

      const successContent = page.getByTestId('reputation-content');
      await expect(successContent).toBeVisible();
      await expect(page.getByTestId('reputation-score')).toHaveText(
        String(SUCCESS_PAYLOAD.score)
      );

      await waitForStableRender(page);
      await expect(page).toHaveScreenshot('reputation-success-desktop.png', {
        fullPage: true,
        animations: 'disabled',
      });
    });

    test('error state', async ({ page }) => {
      await page.route('**/api/reputation/**', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify(ERROR_PAYLOAD),
        });
      });

      await page.goto('/reputation');
      await stabilizePage(page);

      const errorState = page.getByTestId('reputation-error');
      await expect(errorState).toBeVisible();

      await waitForStableRender(page);
      await expect(page).toHaveScreenshot('reputation-error-desktop.png', {
        fullPage: true,
        animations: 'disabled',
      });
    });
  });

  test.describe('mobile', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test('loading state', async ({ page }) => {
      await page.route('**/api/reputation/**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(SUCCESS_PAYLOAD),
        });
      });

      await page.goto('/reputation');
      await stabilizePage(page);

      const loadingIndicator = page.getByTestId('reputation-loading');
      await expect(loadingIndicator).toBeVisible();

      await waitForStableRender(page);
      await expect(page).toHaveScreenshot('reputation-loading-mobile.png', {
        fullPage: true,
        animations: 'disabled',
      });
    });

    test('success state', async ({ page }) => {
      await page.route('**/api/reputation/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(SUCCESS_PAYLOAD),
        });
      });

      await page.goto('/reputation');
      await stabilizePage(page);

      const successContent = page.getByTestId('reputation-content');
      await expect(successContent).toBeVisible();
      await expect(page.getByTestId('reputation-score')).toHaveText(
        String(SUCCESS_PAYLOAD.score)
      );

      await waitForStableRender(page);
      await expect(page).toHaveScreenshot('reputation-success-mobile.png', {
        fullPage: true,
        animations: 'disabled',
      });
    });

    test('error state', async ({ page }) => {
      await page.route('**/api/reputation/**', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify(ERROR_PAYLOAD),
        });
      });

      await page.goto('/reputation');
      await stabilizePage(page);

      const errorState = page.getByTestId('reputation-error');
      await expect(errorState).toBeVisible();

      await waitForStableRender(page);
      await expect(page).toHaveScreenshot('reputation-error-mobile.png', {
        fullPage: true,
        animations: 'disabled',
      });
    });
  });
});