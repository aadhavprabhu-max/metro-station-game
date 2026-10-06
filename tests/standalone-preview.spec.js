import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('raw HTML preview renders the game with every external asset request blocked', async ({ page }) => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  await page.route('**/*', route => route.abort());
  // Exactly the raw-file preview case: no Vite transform or asset server exists.
  await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.metro?.ready);
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('#scene canvas');
    const capture = document.createElement('canvas');
    capture.width = capture.height = 32;
    const ctx = capture.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    let colored = 0;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) colored++;
      colors.add(`${pixels[i] >> 3},${pixels[i + 1] >> 3},${pixels[i + 2] >> 3}`);
    }
    return {
      snapshot: window.metro.snapshot(), colored, colors: colors.size,
      headerPosition: getComputedStyle(document.querySelector('.topbar')).position,
      canvasRect: canvas.getBoundingClientRect().toJSON(),
      glError: window.metro.world.renderer.getContext().getError(),
    };
  });
  expect(result.headerPosition).toBe('absolute');
  expect(result.canvasRect.width).toBe(960);
  expect(result.canvasRect.height).toBe(600);
  expect(result.snapshot.carCount).toBe(3);
  expect(result.snapshot.triangles).toBeGreaterThan(50000);
  expect(result.colored).toBeGreaterThan(900);
  expect(result.colors).toBeGreaterThan(12);
  expect(result.glError).toBe(0);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
  await page.screenshot({ path: 'test-results/standalone-preview.png' });
  const spawn = await page.evaluate(() => window.metro.snapshot());
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.metro.player.distanceTravelled > 0.2);
  await page.keyboard.up('w');
  expect((await page.evaluate(() => window.metro.snapshot())).position).not.toEqual(spawn.position);
  await page.mouse.move(480, 300);
  await page.mouse.down();
  await page.mouse.move(560, 340, { steps: 3 });
  await page.mouse.up();
  const looked = await page.evaluate(() => window.metro.snapshot());
  expect(looked.yaw).toBeLessThan(spawn.yaw);
  expect(looked.pitch).toBeLessThan(spawn.pitch);
  expect(looked.dragging).toBe(false);
  await page.getByRole('button', { name: 'Reset view' }).click();
  expect((await page.evaluate(() => window.metro.snapshot())).position).toEqual(spawn.position);
  expect(errors).toEqual([]);
});
