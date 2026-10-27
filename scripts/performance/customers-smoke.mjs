import { chromium, expect } from '@playwright/test';
import { performanceBaseURL, preparePerformanceSession, waitForScreen } from './navigation.mjs';

const baseURL = performanceBaseURL();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let stage = 'inicializacao';
try {
  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json', viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  await preparePerformanceSession(context, baseURL);
  const page = await context.newPage();
  let paths = []; const pending = new Set(); let activity = 0;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== baseURL || !/^\/api\/(customers|veiculos)/.test(u.pathname)) return;
    paths.push(u.pathname); pending.add(r); activity = performance.now();
  });
  const finish = (r) => { if (pending.delete(r)) activity = performance.now(); };
  page.on('requestfinished', finish); page.on('requestfailed', finish);
  async function stable() { await waitForScreen(page, pending, () => activity, 60_000); }
  async function go() { paths = []; pending.clear(); activity = 0; await page.goto((baseURL + '/clientes'), { waitUntil: 'domcontentloaded' }); await stable(); }
  async function check(name, run) { stage = name; await run(); console.log('PASS: ' + name); }
  async function cancel() {
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await stable();
  }
  await check('Lista abre sem buscar detalhes de clientes ou veiculos', async () => {
    await go(); expect(paths.some((p) => /^\/api\/customers\/\d+/.test(p))).toBe(false);
    expect(paths.some((p) => p.startsWith('/api/veiculos/cliente/'))).toBe(false);
  });
  await check('Busca de clientes continua funcionando e permite limpar', async () => {
    const input = page.locator('input[placeholder^="Buscar"]:visible');
    await input.fill('zzzz'); await stable();
    await page.getByRole('button', { name: 'Limpar busca', exact: true }).click(); await stable();
    await expect(input).toHaveValue('');
  });
  await check('Cadastro abre pelo botao e cancela no desktop', async () => {
    await page.getByRole('button', { name: 'Cliente', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 45_000 }); await cancel();
  });
  await check('Edicao carrega detalhes ao abrir e cancela sem gravar', async () => {
    const loaded = page.waitForResponse((r) => /^\/api\/customers\/\d+$/.test(new URL(r.url()).pathname) && r.status() === 200, { timeout: 45_000 });
    await Promise.all([loaded, page.locator('table tbody tr').first().dblclick()]);
    await expect(page.getByRole('dialog')).toBeVisible(); await cancel();
  });
  await check('Cadastro tambem abre e cancela no tamanho de celular', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await go();
    await page.getByRole('button', { name: 'Cliente', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 45_000 }); await cancel();
  });
  console.log('Smoke concluido sem cadastrar ou editar clientes.');
} catch (error) { console.error(`Falha: ${stage} (${error.name}).`); process.exitCode = 1; }
finally { await browser.close(); }
