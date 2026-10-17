// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Visual regression coverage for design-token consistency (#539)
 * and reduced-motion behavior (#541).
 *
 * These specs capture stable screenshots of critical states and
 * breakpoints. Animations are disabled via reduced-motion emulation
 * so snapshots remain deterministic across runs.
 */

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * Wait for the page to be fully settled: fonts loaded, network idle,
 * and any layout-affecting transitions completed.
 * @param {import('@playwright/test').Page} page
 */
async function settlePage(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    if (document.fonts && typeof document.fonts.ready === 'object') {
      await document.fonts.ready;
    }
  });
  // Give the browser a couple of frames to flush layout/paint.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
      }),
  );
}

/**
 * Disable animations/transitions for deterministic screenshots.
 * @param {import('@playwright/test').Page} page
 */
async function disableAnimations(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
    `,
  });
}

test.describe('design-token consistency — visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('default desktop viewport', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/');
    await disableAnimations(page);
    await settlePage(page);

    await expect(page).toHaveScreenshot('design-tokens-desktop-default.png', {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  });

  test('default mobile viewport', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');
    await disableAnimations(page);
    await settlePage(page);

    await expect(page).toHaveScreenshot('design-tokens-mobile-default.png', {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  });

  test('disabled-action state', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/');
    await disableAnimations(page);

    const disabledAction = page.locator("[data-action-state='disabled']").first();
    const count = await disabledAction.count();

    if (count === 0) {
      test.skip(true, 'No [data-action-state="disabled"] element present on this page.');
      return;
    }

    await disabledAction.scrollIntoViewIfNeeded();
    await settlePage(page);

    await expect(disabledAction).toHaveScreenshot('design-tokens-disabled-action.png', {
      animations: 'disabled',
      caret: 'hide',
    });
  });

  test('reduced-motion state', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/');
    await settlePage(page);

    // Confirm the reduced-motion preference is actually applied.
    const prefersReducedMotion = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(prefersReducedMotion).toBe(true);

    await expect(page).toHaveScreenshot('design-tokens-reduced-motion.png', {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  });
});