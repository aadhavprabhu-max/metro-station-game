// Shared helpers for driving the default Liquid Glass HUD in browser tests.
import { expect } from '@playwright/test';

export async function openMenu(page) {
  const button = page.locator('#gh-menu-button');
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await expect(page.locator('#gh-panel')).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

export async function closeMenu(page) {
  const button = page.locator('#gh-menu-button');
  if (await button.getAttribute('aria-expanded') === 'true') await button.click();
  await expect(page.locator('#gh-panel')).toBeHidden();
}

/** Uses the menu's Start button, which calls the same handler as the original Start buttons. */
export async function startLine(page, lineId) {
  await openMenu(page);
  await page.getByRole('button', { name: `Start ${lineId}`, exact: true }).click();
  await expect(page.locator('#gh-panel')).toBeHidden();
}

/** Waits until no HUD spring, camera glide or map animation is pending. */
// Software WebGL in CI can run below 1 fps, so allow generous real time.
export const hudSettled = page => page.waitForFunction(() => window.metroHud?.settled, undefined, { timeout: 180000 });
