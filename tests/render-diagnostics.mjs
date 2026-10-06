import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const args = ['--no-sandbox', '--disable-dev-shm-usage'];
if (process.env.SOFTWARE_WEBGL) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleMessages = [];
const requests = [];
page.on('pageerror', error => consoleMessages.push({ type: 'pageerror', text: error.message }));
page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() }); });
page.on('requestfailed', request => requests.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('response', response => { if (response.status() >= 400) requests.push({ url: response.url(), status: response.status() }); });
try {
  const url = process.env.METRO_URL || 'http://127.0.0.1:5173/';
  let app = page;
  if (process.env.EMBEDDED_PREVIEW) {
    await page.setContent('<!doctype html><html><body style="margin:0;overflow:hidden"></body></html>');
    const navigation = page.waitForEvent('framenavigated', { predicate: frame => frame.url() === url });
    await page.evaluate(url => {
      const iframe = document.createElement('iframe');
      iframe.title = 'Metro game preview';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.style.cssText = 'display:block;border:0;width:100vw;height:100vh';
      iframe.src = url;
      document.body.appendChild(iframe);
    }, url);
    app = await navigation;
  } else {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  await app.waitForFunction(() => window.metro?.ready || !document.querySelector('#error').hidden, { timeout: 45000 });
  const before = await app.evaluate(() => window.metro?.frames ?? 0);
  await page.waitForTimeout(1000);
  const diagnostic = await app.evaluate(({ before, consoleMessages, requests }) => {
    const runtime = window.metro;
    const canvas = document.querySelector('#scene canvas');
    const context = runtime?.world.renderer.getContext();
    const extension = context?.getExtension('WEBGL_debug_renderer_info');
    let meshes = 0, lights = 0;
    runtime?.world.scene.traverse(node => { if (node.isMesh) meshes++; if (node.isLight) lights++; });
    const scratch = document.createElement('canvas');
    scratch.width = 32; scratch.height = 32;
    const ctx = scratch.getContext('2d');
    if (canvas) ctx.drawImage(canvas, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    let coloredPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30 && pixels[i + 3] > 0) coloredPixels++;
    return {
      consoleMessages, requests, state: runtime?.snapshot(), meshes, lights,
      embedded: window.parent !== window,
      framesBefore: before, framesAfter: runtime?.frames, hidden: document.hidden,
      canvasAttached: canvas?.isConnected, canvasSize: canvas && [canvas.width, canvas.height],
      canvasRect: canvas?.getBoundingClientRect().toJSON(),
      contextLost: context?.isContextLost(), glError: context?.getError(),
      gpu: extension && context.getParameter(extension.UNMASKED_RENDERER_WEBGL),
      attributes: context?.getContextAttributes(), capturedColoredPixels: coloredPixels,
      errorMessage: document.querySelector('#error-message').textContent,
    };
  }, { before, consoleMessages, requests });
  console.log(JSON.stringify(diagnostic, null, 2));
  const canvasData = await app.locator('#scene canvas').evaluate(canvas => canvas.toDataURL('image/png'));
  await writeFile(process.env.METRO_CANVAS_SCREENSHOT || '/tmp/metro-canvas-diagnostics.png', Buffer.from(canvasData.split(',')[1], 'base64'));
  await page.screenshot({ path: process.env.METRO_SCREENSHOT || '/tmp/metro-render-diagnostics.png' });
  if (diagnostic.glError || diagnostic.contextLost || !diagnostic.canvasAttached || diagnostic.capturedColoredPixels < 900 || diagnostic.framesAfter <= diagnostic.framesBefore) {
    throw new Error('The canvas is empty, detached, or the render loop is not advancing.');
  }
  if (consoleMessages.some(message => ['error', 'pageerror'].includes(message.type)) || requests.length) throw new Error('The browser reported a runtime or resource-loading error.');
} finally {
  await browser.close();
}
