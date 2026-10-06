import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
let html = await readFile(resolve(dist, 'app.html'), 'utf8');
const stylesheet = html.match(/<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
const script = html.match(/<script\s+type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
if (!stylesheet || !script) throw new Error('The Vite output is missing its entry stylesheet or script.');
// Vite URLs include the Pages base; files remain under dist/assets.
const assetPath = url => resolve(dist, 'assets', url.split('/assets/')[1]);
const css = await readFile(assetPath(stylesheet[1]), 'utf8');
const javascript = await readFile(assetPath(script[1]), 'utf8');
// The entry has no dynamic imports: all Three.js and game modules are bundled.
// Use a classic inline script so a raw HTML / file preview needs no module loader,
// package registry, asset server, or cross-origin module requests.
if (/\bimport\s*\(/.test(javascript)) throw new Error('The standalone build contains a dynamic import.');
html = html.replace(stylesheet[0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
html = html.replace(script[0], '');
const inlineScript = `<script>(()=>{\n${javascript.replace(/<\/script/gi, '<\\/script')}\n})();</script>`;
html = html.replace('</body>', () => `${inlineScript}\n</body>`);
await writeFile(resolve(dist, 'index.html'), html);
await writeFile(resolve(root, 'index.html'), html);
console.log('Created self-contained index.html and dist/index.html (no external scripts or styles).');
