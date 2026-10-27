import { chromium, expect } from '@playwright/test';
import { performanceBaseURL, waitForScreen, preparePerformanceSession } from './navigation.mjs';

const baseURL = performanceBaseURL();

// Usa dados existentes somente para leitura. Carrinho e formularios nao sao salvos.
let stage = 'inicializacao';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ storageState: 'playwright/.auth/performance-user.json', viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  await preparePerformanceSession(context, baseURL);
  const page = await context.newPage();
  let requests = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.origin === baseURL && url.pathname.startsWith('/api/')) requests.push(url.pathname);
  });
  async function check(name, run) { stage = name; await run(); console.log(`PASS: ${name}`); }
  async function go(route) {
    await page.goto(`http://localhost:3000${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForScreen(page, new Set(), () => 0, 45_000);
  }
  const response = (path) => page.waitForResponse((r) => new URL(r.url()).pathname === path && r.status() === 200, { timeout: 45_000 });
  async function close() { await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); }

  await check('Agenda abre sem consultar servicos ou veiculos do formulario', async () => {
    await go('/agendamentos');
    expect(requests).not.toContain('/api/agendamentos/lookup');
    expect(requests).not.toContain('/api/tipos/servicos');
  });
  await check('Recarregar agenda continua buscando a lista', async () => {
    const loaded = response('/api/agendamentos');
    await page.getByRole('button', { name: 'Recarregar', exact: true }).click();
    await loaded;
  });
  await check('Novo agendamento carrega opcoes ao abrir e permite cancelar', async () => {
    const loaded = Promise.all([response('/api/agendamentos/lookup'), response('/api/tipos/servicos')]);
    await page.getByRole('button', { name: 'Novo agendamento', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Novo agendamento' })).toBeVisible();
    await loaded;
    await expect(page.getByRole('button', { name: 'Selecionar servicos', exact: true })).toBeEnabled();
    await close();
  });
  await check('PDV busca produtos sem concluir venda', async () => {
    await go('/pdv');
    const search = page.getByPlaceholder('Buscar por nome, referência ou código...');
    const loaded = response('/api/pdv/products');
    await search.fill('teste-sem-produto-987654321');
    await loaded;
    const cleared = response('/api/pdv/products');
    await search.fill('');
    await cleared;
  });
  await check('PDV adiciona e remove um item somente no carrinho local', async () => {
    const add = page.getByRole('button', { name: /^Adicionar .+ ao carrinho$/, disabled: false }).first();
    await expect(add).toBeVisible({ timeout: 30_000 });
    await add.click();
    const remove = page.getByRole('button', { name: /^Remover .+ do carrinho$/ }).first();
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(page.getByRole('button', { name: /^Remover .+ do carrinho$/ })).toHaveCount(0);
  });
  await check('Saida do PDV retorna ao Historico de Vendas', async () => {
    await page.getByRole('button', { name: 'Sair do PDV', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/historicovendas', { timeout: 45_000 });
    await waitForScreen(page, new Set(), () => 0, 45_000);
  });
  await check('Historico busca e limpa a pesquisa sem perder a listagem', async () => {
    const input = page.getByRole('searchbox', { name: /Buscar no hist/ });
    const searched = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/venda' && url.searchParams.get('search') === 'perf-busca-inexistente' && r.status() === 200;
    });
    await Promise.all([searched, input.fill('perf-busca-inexistente')]);
    const cleared = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/venda' && !url.searchParams.get('search') && r.status() === 200;
    });
    await Promise.all([cleared, page.getByRole('button', { name: 'Limpar busca', exact: true }).click()]);
    await expect(input).toHaveValue('');
  });
  await check('Historico abre os detalhes existentes sem salvar', async () => {
    const row = page.locator('table tbody tr').first();
    await expect(row).toBeVisible();
    await row.dblclick();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 45_000 });
    await close();
  });
  await check('Historico carrega filtros ao abrir', async () => {
    const loaded = response('/api/venda/filtros');
    await page.getByRole('button', { name: /^Filtros/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await loaded;
    await close();
  });
  await check('Novo aluguel abre e cancela sem movimentar estoque', async () => {
    requests = [];
    await go('/alugueis');
    await page.getByRole('button', { name: 'Novo aluguel', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
    // DialogShell protege contra Escape acidental; cancelar e uma acao explicita.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  console.log('Smoke operacional concluido sem criar vendas, agendamentos ou alugueis.');
} catch (error) {
  console.error(`Falha no smoke operacional: ${stage} (${error.name}).`);
  process.exitCode = 1;
} finally { await browser.close(); }
