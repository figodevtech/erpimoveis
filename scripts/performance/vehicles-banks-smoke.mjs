import { chromium, expect } from '@playwright/test';
import { performanceBaseURL, preparePerformanceSession, waitForScreen } from './navigation.mjs';

const baseURL = performanceBaseURL();

// Abre formularios e consulta listas; nao cadastra, edita, transfere ou movimenta saldo.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let stage = 'inicializacao';
try {
  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json', viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  await preparePerformanceSession(context, baseURL);
  const page = await context.newPage();
  let requests = [];
  const pending = new Set();
  let activity = 0;
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.origin !== baseURL || !/^\/api\/(veiculos|bancos|customers)/.test(url.pathname)) return;
    pending.add(r); activity = performance.now();
    requests.push({ path: url.pathname, transactions: url.searchParams.get('onlyTransactions') === 'true' });
  });
  const finish = (r) => { if (pending.delete(r)) activity = performance.now(); };
  page.on('requestfinished', finish); page.on('requestfailed', finish);
  async function stable() { await waitForScreen(page, pending, () => activity, 60_000); }
  async function go(route) {
    requests = []; pending.clear(); activity = 0;
    await page.goto(baseURL + route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await stable();
  }
  async function check(name, run) { stage = name; await run(); console.log('PASS: ' + name); }
  async function cancel() {
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await stable();
  }
  await check('Veiculos abre sem consultar clientes de formularios', async () => {
    await go('/veiculos');
    expect(requests.filter((r) => r.path === '/api/veiculos')).toHaveLength(1);
    expect(requests.some((r) => r.path.startsWith('/api/customers'))).toBe(false);
  });
  await check('Veiculos pesquisa e limpa a busca', async () => {
    const input = page.locator('input[placeholder^="Buscar ve"]:visible');
    await input.fill('zzzz'); await stable();
    await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
    await expect(input).toHaveValue(''); await stable();
  });
  await check('Novo veiculo abre e cancela sem salvar', async () => {
    await page.getByRole('button', { name: /^Ve.culo$/, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 45_000 });
    await cancel();
  });
  await check('Edicao abre sem a consulta redundante por cliente', async () => {
    requests = [];
    const loaded = page.waitForResponse((r) => /^\/api\/veiculos\/\d+$/.test(new URL(r.url()).pathname) && r.status() === 200, { timeout: 45_000 });
    await page.locator('table tbody tr').first().getByRole('button').first().click();
    await Promise.all([loaded, page.getByRole('menuitem', { name: 'Editar', exact: true }).click()]);
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(requests.some((r) => r.path.startsWith('/api/veiculos/cliente/'))).toBe(false);
    await cancel();
  });
  await check('Transferencia abre a escolha de cliente e permite sair sem transferir', async () => {
    await page.locator('table tbody tr').first().getByRole('button').first().click();
    await page.getByRole('menuitem', { name: /Transferir/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 45_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  await check('Bancos consulta resumo e transacoes uma vez na abertura', async () => {
    await go('/bancos');
    expect(requests.filter((r) => r.path === '/api/bancos/resumo' && !r.transactions)).toHaveLength(1);
    expect(requests.filter((r) => r.path === '/api/bancos/resumo' && r.transactions)).toHaveLength(1);
  });
  await check('Bancos recarrega resumo e transacoes', async () => {
    requests = [];
    await page.getByRole('button', { name: 'Recarregar', exact: true }).click(); await stable();
    expect(requests.filter((r) => r.path === '/api/bancos/resumo' && !r.transactions)).toHaveLength(1);
    expect(requests.filter((r) => r.path === '/api/bancos/resumo' && r.transactions)).toHaveLength(1);
  });
  console.log('Smoke concluido sem gravacoes de negocio.');
} catch (error) {
  console.error(`Falha: ${stage} (${error.name}).`);
  process.exitCode = 1;
} finally { await browser.close(); }
