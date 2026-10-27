import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { performanceBaseURL, preparePerformanceSession, waitForScreen } from './navigation.mjs';

const baseURL = performanceBaseURL();
const dist = process.env.NEXT_DIST_DIR || '.next';
const directory = `${dist}/static/chunks`;
const codec = fs.readdirSync(directory).find((name) => {
  if (!name.endsWith('.js')) return false;
  const text = fs.readFileSync(`${directory}/${name}`, 'utf8');
  return text.includes('libheif') && text.includes('heicTo');
});
assert.ok(codec, 'Build deve continuar incluindo conversor HEIC');
const codecPath = `/_next/static/chunks/${codec}`;
const manifestURLs = [...fs.readFileSync('public/sw.js', 'utf8').matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
assert.ok(manifestURLs.length > 0);
assert.equal(manifestURLs.some((url) => /(?:^|\/)server\/|(?:app-)?build-manifest\.json|react-loadable-manifest\.json/.test(url)), false);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json' });
  await preparePerformanceSession(context, baseURL);
  const page = await context.newPage();
  await page.goto(`${baseURL}/clientes`);
  await waitForScreen(page, new Set(), () => 0, 60_000);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 60_000 });
  const before = await page.evaluate(async (path) => {
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) {
      if (new URL(req.url).pathname === path) return true;
    }
    return false;
  }, codecPath);
  assert.equal(before, false, 'Codec nao deve ser baixado no precache');
  assert.equal(await page.evaluate(async (path) => (await fetch(path)).status, codecPath), 200);
  await page.waitForFunction(async (path) => Boolean(await caches.match(path)), codecPath, { timeout: 15_000 });
  await context.setOffline(true);
  assert.equal(await page.evaluate(async (path) => (await fetch(path)).status, codecPath), 200);
  console.log('PASS: HEIC fica fora do precache, baixa sob demanda e permanece em cache de runtime');
} finally { await browser.close(); }
