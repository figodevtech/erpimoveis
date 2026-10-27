import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { performanceBaseURL, preparePerformanceSession, waitForScreen } from './navigation.mjs';

const baseURL = performanceBaseURL();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json' });
  await preparePerformanceSession(context, baseURL);
  const page = await context.newPage();
  await page.goto(`${baseURL}/clientes`);
  await waitForScreen(page, new Set(), () => 0, 60_000);
  const styles = await page.evaluate(() => ({
    margin: getComputedStyle(document.body).marginTop,
    boxSizing: getComputedStyle(document.body).boxSizing,
    linked: [...document.styleSheets].some((sheet) => sheet.href?.includes('/_next/static/css/')),
  }));
  assert.equal(styles.margin, '0px');
  assert.equal(styles.boxSizing, 'border-box');
  assert.equal(styles.linked, true);
  console.log('PASS: CSS gerado carrega e aplica estilos base do Tailwind');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 60_000 });
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    const entries = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) entries.push(req.url);
    return { active: registration.active?.state, script: registration.active?.scriptURL, entries };
  });
  assert.equal(state.active, 'activated');
  assert.equal(new URL(state.script).pathname, '/sw.js');
  assert.equal(state.entries.some((u) => /^\/api(?:\/|$)/.test(new URL(u).pathname)), false);
  assert.equal(state.entries.some((u) => ['/clientes', '/dashboard', '/'].includes(new URL(u).pathname)), false);
  const cachedAsset = state.entries.find((u) => new URL(u).pathname.startsWith('/_next/static/'));
  assert.ok(cachedAsset, 'Build deve ter assets estaticos em precache');
  // Cache Storage usa chave interna com revisao; o browser pede a URL publica.
  const staticAsset = new URL(cachedAsset);
  staticAsset.searchParams.delete('__WB_REVISION__');
  console.log('PASS: service worker ativa, verifica atualizacao e guarda estaticos sem paginas/API privadas');
  let requests = 0;
  context.on('request', (r) => { if (new URL(r.url()).pathname === '/api/customers') requests++; });
  const online = await page.evaluate(async () => (await fetch('/api/customers?limit=1')).status);
  assert.equal(online, 200); assert.ok(requests > 0);
  await context.setOffline(true);
  const offline = await page.evaluate(async (asset) => {
    let api = false, document = false;
    try { api = (await fetch('/api/customers?limit=1')).ok; } catch { /* NetworkOnly */ }
    try { document = (await fetch('/clientes', { headers: { RSC: '1' } })).ok; } catch { /* NetworkOnly */ }
    const staticResponse = await fetch(asset);
    return { api, document, static: staticResponse.ok };
  }, staticAsset.href);
  assert.deepEqual(offline, { api: false, document: false, static: true });
  await context.setOffline(false);
  await page.reload();
  await waitForScreen(page, new Set(), () => 0, 60_000);
  assert.equal(new URL(page.url()).pathname, '/clientes');
  console.log('PASS: offline mantem estatico, bloqueia dados privados antigos e reconecta normalmente');
} finally { await browser.close(); }
