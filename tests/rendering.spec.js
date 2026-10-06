import { test, expect } from '@playwright/test';

async function canvasPixels(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#scene canvas');
    const capture = document.createElement('canvas');
    capture.width = capture.height = 32;
    const ctx = capture.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    const colors = new Set();
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) colored++;
      colors.add(`${pixels[i] >> 3},${pixels[i + 1] >> 3},${pixels[i + 2] >> 3}`);
    }
    return { colored, colors: colors.size, size: [canvas.width, canvas.height] };
  });
}

test('preview captures retain actual scene pixels between animation frames', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.metro?.ready);
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
  await page.waitForTimeout(100);
  const pixels = await canvasPixels(page);
  expect(pixels.colored).toBeGreaterThan(900);
  expect(pixels.colors).toBeGreaterThan(12);
});

test('a preview container becoming visible resizes and renders without a window resize', async ({ page }) => {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const container = document.querySelector('#scene');
      if (!container) return;
      container.style.width = '0px'; container.style.height = '0px';
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.metro);
  await page.evaluate(() => {
    window.metro.world.renderer.setAnimationLoop(null);
    const container = document.querySelector('#scene');
    container.style.removeProperty('width'); container.style.removeProperty('height');
  });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#scene canvas');
    return window.metro.ready && canvas.width > 100 && canvas.height > 100;
  });
  expect((await canvasPixels(page)).colored).toBeGreaterThan(900);
  expect(await page.evaluate(() => window.metro.world.camera.aspect)).toBeCloseTo(960 / 600, 5);
});

test('startup presents a real first frame even while document visibility is hidden', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await page.goto('/');
  await page.waitForFunction(() => window.metro?.ready);
  await page.evaluate(() => window.metro.world.renderer.setAnimationLoop(null));
  expect((await canvasPixels(page)).colored).toBeGreaterThan(900);
});
