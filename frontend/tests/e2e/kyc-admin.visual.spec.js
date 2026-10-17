// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Visual regression coverage for the KYC admin route authorization.
 *
 * Captures stable responsive snapshots (mobile / tablet / desktop) for:
 *  - the primary success path (authorized admin sees the KYC admin dashboard)
 *  - failure path: unauthorized role (non-admin is denied)
 *  - boundary path: empty / loading state (no pending KYC submissions)
 *
 * Determinism notes:
 *  - All network calls are mocked with fixed fixtures (no live backend).
 *  - Animations, transitions and caret blinking are disabled via injected CSS.
 *  - The clock is frozen so any relative timestamps render identically.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const KYC_ADMIN_PATH = '/kyc/admin';

/** CSS that removes non-deterministic visual noise from snapshots. */
const DISABLE_ANIMATIONS_CSS = `
  *,
  *::before,
  *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
  html {
    scrollbar-width: none !important;
  }
  html::-webkit-scrollbar {
    display: none !important;
  }
`;

/** Fixed timestamp used by every fixture so rendered dates never drift. */
const FIXED_NOW = new Date('2024-01-15T12:00:00.000Z');

/**
 * Deterministic fixtures. No secrets, tokens or PII beyond obviously fake data.
 */
const FIXTURES = {
  authorizedAdmin: {
    id: 'admin-fixture-001',
    email: 'admin@example.test',
    role: 'admin',
    permissions: ['kyc:read', 'kyc:review'],
  },
  unauthorizedUser: {
    id: 'user-fixture-002',
    email: 'user@example.test',
    role: 'user',
    permissions: [],
  },
  pendingSubmissions: [
    {
      id: 'kyc-fixture-001',
      applicantName: 'Test Applicant One',
      status: 'pending',
      submittedAt: '2024-01-10T09:00:00.000Z',
    },
    {
      id: 'kyc-fixture-002',
      applicantName: 'Test Applicant Two',
      status: 'pending',
      submittedAt: '2024-01-11T09:00:00.000Z',
    },
  ],
  emptySubmissions: [],
};

/**
 * Installs deterministic browser state: frozen clock, disabled animations,
 * and a stable color scheme.
 *
 * @param {import('@playwright/test').Page} page
 */
async function prepareDeterministicPage(page) {
  await page.clock.install({ time: FIXED_NOW });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
}

/**
 * Mocks the session/auth endpoint so the route renders a known role.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} user
 */
async function mockSession(page, user) {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user }),
    });
  });
}

/**
 * Mocks the KYC submissions endpoint with a fixed payload.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<object>} submissions
 */
async function mockSubmissions(page, submissions) {
  await page.route('**/api/kyc/submissions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ submissions }),
    });
  });
}

/**
 * Waits for the page to settle so snapshots are stable.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForStableRender(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // Give layout a frame to settle after fonts/animations are disabled.
  await page.waitForTimeout(100);
}

test.describe('KYC admin route authorization — visual regression', () => {
  for (const viewport of VIEWPORTS) {
    test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test('primary success path: authorized admin sees dashboard', async ({ page }) => {
        await mockSession(page, FIXTURES.authorizedAdmin);
        await mockSubmissions(page, FIXTURES.pendingSubmissions);

        await page.goto(KYC_ADMIN_PATH);
        await prepareDeterministicPage(page);
        await waitForStableRender(page);

        // Sanity check: the authorized admin content is actually rendered.
        await expect(page.getByRole('heading', { name: /kyc admin/i })).toBeVisible();

        await expect(page).toHaveScreenshot(
          `kyc-admin-success-${viewport.name}.png`,
          { fullPage: true, animations: 'disabled' },
        );
      });

      test('failure path: unauthorized role is denied', async ({ page }) => {
        await mockSession(page, FIXTURES.unauthorizedUser);
        await mockSubmissions(page, FIXTURES.pendingSubmissions);

        await page.goto(KYC_ADMIN_PATH);
        await prepareDeterministicPage(page);
        await waitForStableRender(page);

        // Sanity check: the dashboard must NOT be rendered for a non-admin.
        await expect(page.getByRole('heading', { name: /kyc admin/i })).toHaveCount(0);
        await expect(
          page.getByText(/not authorized|access denied|forbidden/i).first(),
        ).toBeVisible();

        await expect(page).toHaveScreenshot(
          `kyc-admin-unauthorized-${viewport.name}.png`,
          { fullPage: true, animations: 'disabled' },
        );
      });

      test('boundary path: empty submissions state', async ({ page }) => {
        await mockSession(page, FIXTURES.authorizedAdmin);
        await mockSubmissions(page, FIXTURES.emptySubmissions);

        await page.goto(KYC_ADMIN_PATH);
        await prepareDeterministicPage(page);
        await waitForStableRender(page);

        // Sanity check: the empty state is shown instead of a table of rows.
        await expect(
          page.getByText(/no pending|no submissions|nothing to review/i).first(),
        ).toBeVisible();

        await expect(page).toHaveScreenshot(
          `kyc-admin-empty-${viewport.name}.png`,
          { fullPage: true, animations: 'disabled' },
        );
      });
    });
  }
});