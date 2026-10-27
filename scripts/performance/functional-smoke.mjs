import { chromium, expect } from '@playwright/test';
import { performanceBaseURL, waitForScreen, preparePerformanceSession } from './navigation.mjs';

const baseURL = performanceBaseURL();

// Validacao de leitura/abertura. Nao clica em salvar, pagar, emitir ou transferir.
let stage = 'inicializacao';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({
    storageState: 'playwright/.auth/performance-user.json',
    viewport: { width: 1440, height: 900 }, locale: 'pt-BR',
  });
  await preparePerformanceSession(context, baseURL);
  const page = await context.newPage();
  const apiPaths = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === baseURL && url.pathname.startsWith('/api/')) apiPaths.push(url.pathname);
  });
  async function check(name, action) {
    stage = name;
    await action();
    console.log(`PASS: ${name}`);
  }
  async function closeDialog() {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  async function openAction(name) {
    await page.getByRole('button', { name: 'Ações', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 45_000 });
  }
  await check('Fluxo abre sem consultar auxiliares de formularios fechados', async () => {
    await page.goto((baseURL + '/fluxodecaixa'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForScreen(page, new Set(), () => 0, 45_000);
    for (const path of ['/api/tipos/planos-de-conta', '/api/tipos/categorias-transacao', '/api/tipos/centros-de-custo']) {
      expect(apiPaths).not.toContain(path);
    }
  });
  await check('Filtros financeiros carregam opcoes ao abrir', async () => {
    const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tipos/planos-de-conta' && r.status() === 200, { timeout: 45_000 });
    await page.getByRole('button', { name: /^Filtros/ }).click();
    await expect(page.getByRole('heading', { name: 'Filtros do fluxo de caixa' })).toBeVisible();
    await loaded;
    await closeDialog();
  });
  await check('Nova transacao abre, fecha e reabre', async () => {
    await openAction('Nova transação');
    await expect(page.getByRole('heading', { name: 'Nova transação', exact: true })).toBeVisible();
    await closeDialog();
    await openAction('Nova transação');
    await expect(page.getByRole('heading', { name: 'Nova transação', exact: true })).toBeVisible();
    await closeDialog();
  });
  await check('Transferencia abre sem executar operacao', async () => {
    await openAction('Transferência entre contas');
    await expect(page.getByRole('heading', { name: 'Transferência entre contas' })).toBeVisible();
    await closeDialog();
  });
  await check('Conciliacao OFX abre sem importar arquivo', async () => {
    await openAction('Conciliação bancária (OFX)');
    // Esta tela protege deliberadamente a saida: Escape nao pode descartar
    // o trabalho. Verifica a protecao sem importar ou confirmar movimentos.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Fechar conciliação', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Continuar conciliando', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
  apiPaths.length = 0;
  await check('Relatorios abre sem consultar opcoes de formularios fechados', async () => {
    await page.goto((baseURL + '/relatorios'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForScreen(page, new Set(), () => 0, 45_000);
    for (const path of ['/api/tipos/categorias-transacao', '/api/tipos/planos-de-conta', '/api/users', '/api/ordens/realizadores', '/api/tipos/setores']) {
      expect(apiPaths).not.toContain(path);
    }
  });
  await check('Relatorio financeiro carrega categorias ao abrir', async () => {
    const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tipos/categorias-transacao' && r.status() === 200, { timeout: 45_000 });
    await page.getByRole('button', { name: /^Fluxo de Caixa/ }).click();
    await expect(page.getByRole('heading', { name: 'Relatório de fluxo de caixa' })).toBeVisible();
    await loaded;
    await closeDialog();
  });
  for (const name of ['Receitas por categoria', 'Despesas por categoria', 'Relação de vendas', 'Relação de ordens de serviço']) {
    await check(`Relatorio ${name} abre e preserva datas ao reabrir`, async () => {
      await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Este mês', exact: true }).click();
      const date = dialog.getByRole('button', { name: /^\d{2}\/\d{2}\/\d{4}$/ }).first();
      await expect(date).toBeVisible();
      const dateText = await date.innerText();
      await closeDialog();
      await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
      await expect(dialog).toBeVisible();
      await expect(date).toHaveText(dateText);
      await closeDialog();
    });
  }
  await check('Nova transacao abre no layout mobile', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto((baseURL + '/fluxodecaixa'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForScreen(page, new Set(), () => 0, 45_000);
    await openAction('Nova transação');
    await expect(page.getByRole('heading', { name: 'Nova transação', exact: true })).toBeVisible();
    await closeDialog();
  });
  console.log('Smoke concluido sem salvar registros financeiros.');
} catch (error) {
  console.error(`Falha no smoke: ${stage} (${error.name}).`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
