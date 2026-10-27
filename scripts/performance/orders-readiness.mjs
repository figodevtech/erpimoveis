import { chromium } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { performanceBaseURL, preparePerformanceSession, findMenuLink, waitForScreen } from './navigation.mjs';

const baseURL = performanceBaseURL();

// Compara disponibilidade da lista com estabilidade de rede, sem clicar em acoes de OS.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json', viewport: { width: 1440, height: 900 } });
  await preparePerformanceSession(context, baseURL);
  const page = await context.newPage();
  const results = [];
  const pending = new Set(); let activity = 0;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== baseURL || !u.pathname.startsWith('/api/ordens')) return;
    pending.add(r); activity = performance.now();
  });
  const finish = (r) => { if (pending.delete(r)) activity = performance.now(); };
  page.on('requestfinished', finish); page.on('requestfailed', finish);
  for (let round = 1; round <= 2; round++) {
    pending.clear(); activity = 0;
    await page.goto((baseURL + '/clientes'), { waitUntil: 'domcontentloaded' });
    await waitForScreen(page, new Set(), () => 0, 60_000);
    const link = await findMenuLink(page, '/ordens');
    const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/ordens' && r.status() === 200, { timeout: 45_000 });
    const start = performance.now();
    await Promise.all([loaded, link.click()]);
    const menu = page.getByRole('button', { name: 'Abrir menu', exact: true }).first();
    // trial verifica visibilidade, habilitacao e hit target, sem executar o clique.
    await menu.click({ trial: true, timeout: 30_000 });
    const listInteractiveMs = Math.round(performance.now() - start);
    await waitForScreen(page, pending, () => activity, 60_000);
    const result = { round, listInteractiveMs, ordersApiSettledMs: Math.round(performance.now() - start) };
    results.push(result); console.log(JSON.stringify(result));
  }
  await mkdir('artifacts/performance', { recursive: true });
  const output = `artifacts/performance/orders-readiness-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(output, JSON.stringify({ note: 'Cenario exige OS visivel; verifica menu por trial, sem alterar dados. A estabilidade considera APIs de Ordens e nao substitui perf:navigation.', results }, null, 2));
  console.log(`Relatorio: ${output}`);
} finally { await browser.close(); }
