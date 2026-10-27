import { chromium, expect } from '@playwright/test';
import { performanceBaseURL, preparePerformanceSession, waitForScreen } from './navigation.mjs';

const baseURL = performanceBaseURL();

// Somente navegacao e abertura/cancelamento: nao emite, sincroniza ou altera status.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let stage = 'inicializacao';
try {
  // A fixture de status precisa interceptar GET; os demais testes e navegacao validam com PWA ativo.
  const context = await browser.newContext({ serviceWorkers: 'block', storageState: 'playwright/.auth/performance-user.json', viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  await preparePerformanceSession(context, baseURL);
  const page = await context.newPage();
  let requests = [];
  const pending = new Set(); let activity = 0;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== baseURL || !/^\/api\/(fiscal|ordens|banks|payment-methods)/.test(u.pathname)) return;
    requests.push(u.pathname); pending.add(r); activity = performance.now();
  });
  const finish = (r) => { if (pending.delete(r)) activity = performance.now(); };
  page.on('requestfinished', finish); page.on('requestfailed', finish);
  async function stable() { await waitForScreen(page, pending, () => activity, 60_000); }
  async function go(route) { requests = []; pending.clear(); activity = 0; await page.goto(baseURL + route, { waitUntil: 'domcontentloaded' }); await stable(); }
  async function check(name, run) { stage = name; await run(); console.log('PASS: ' + name); }
  await check('Fiscal consulta indicadores uma vez e nao carrega auxiliares da entrada', async () => {
    await go('/fiscal');
    expect(requests.filter((r) => r === '/api/fiscal/kpis')).toHaveLength(1);
    expect(requests).not.toContain('/api/banks'); expect(requests).not.toContain('/api/payment-methods');
  });
  await check('Fiscal recarrega a lista', async () => {
    requests = []; await page.getByRole('button', { name: 'Recarregar', exact: true }).click(); await stable();
    expect(requests).toContain('/api/fiscal/notas-emitidas');
  });
  await check('Fiscal pesquisa e limpa a busca', async () => {
    const input = page.getByRole('textbox', { name: 'Buscar notas fiscais', exact: true });
    await input.fill('zzzz'); await stable(); await input.fill(''); await stable();
    await expect(input).toHaveValue('');
  });
  await check('Fiscal abre e fecha filtros', async () => {
    await page.getByRole('button', { name: /^Filtros/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  await check('Fiscal alterna entre documentos proprios e de terceiros sem sincronizar', async () => {
    requests = []; await page.getByRole('button', { name: 'Terceiros', exact: true }).click(); await stable();
    expect(requests).toContain('/api/fiscal/notas-recebidas');
    await page.getByRole('button', { name: /^Pr.prias$/ }).click(); await stable();
  });
  await check('Ordens abre sem buscar formas de pagamento', async () => {
    await go('/ordens'); expect(requests).not.toContain('/api/payment-methods');
  });
  await check('Ordens pesquisa e limpa sem alterar dados', async () => {
    const input = page.locator('input[placeholder^="Buscar..."]:visible');
    await input.fill('zzzz'); await stable(); await input.fill(''); await stable();
    await expect(input).toHaveValue('');
  });
  stage = 'Confirmacao financeira';
  await page.getByRole('tab', { name: /^Em Andamento/ }).click(); await stable();
  let verified = false;
  const menus = page.getByRole('button', { name: 'Abrir menu', exact: true });
  for (let index = 0; index < Math.min(await menus.count(), 5); index++) {
    await menus.nth(index).click();
    const action = page.getByRole('menuitem', { name: 'Enviar p/ pagamento', exact: true });
    if (await action.count()) {
      const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/payment-methods' && r.status() === 200, { timeout: 45_000 });
      await Promise.all([loaded, action.click()]);
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      verified = true; console.log('PASS: Confirmacao financeira carrega opcoes ao abrir e cancela sem enviar'); break;
    }
    await page.keyboard.press('Escape');
  }
  if (!verified) {
    // Sem OS em andamento: simula so o status na resposta de leitura da tabela.
    // Os detalhes e as formas continuam vindo das APIs; nao grava status real.
    const response = await context.request.get((baseURL + '/api/ordens?limit=1'));
    if (!response.ok()) throw new Error('Falha ao consultar amostra de OS.');
    const sample = await response.json();
    if (sample.items?.length) {
      await page.route((url) => url.pathname === '/api/ordens', async (route) => {
        if (route.request().method() !== 'GET') throw new Error('Gravacao inesperada no teste.');
        await route.fulfill({ json: { ...sample, items: [{ ...sample.items[0], status: 'EM_ANDAMENTO' }], total: 1, totalPages: 1 } });
      });
      await go('/ordens');
      await page.getByRole('button', { name: 'Abrir menu', exact: true }).first().click();
      const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/payment-methods' && r.status() === 200, { timeout: 45_000 });
      await Promise.all([loaded, page.getByRole('menuitem', { name: 'Enviar p/ pagamento', exact: true }).click()]);
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      console.log('PASS: Confirmacao carrega formas e cancela (status simulado somente na interface).');
    } else console.log('SKIP: sem OS cadastrada para testar abertura da confirmacao.');
  }
  console.log('Smoke concluido sem emitir notas, sincronizar documentos ou alterar ordens.');
} catch (error) { console.error(`Falha: ${stage} (${error.name}).`); process.exitCode = 1; }
finally { await browser.close(); }
