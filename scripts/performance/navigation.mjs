import { chromium } from '@playwright/test';
import { mkdir, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

export const DEFAULT_ROUTES = ['/dashboard', '/ordens', '/clientes', '/estoque', '/veiculos', '/agendamentos', '/fluxodecaixa', '/bancos', '/fiscal', '/relatorios'];
const AUTH_FILE = path.resolve('playwright/.auth/performance-user.json');
const PAGE_CONTENT_SELECTOR = 'main:not([data-slot="sidebar-inset"])';
const BACKGROUND = /^\/api\/(?:auth(?:\/|$)|chat(?:\/|$)|notifications(?:\/|$)|radios?(?:\/|$)|plano\/status)/;

// Nao registra parametros de busca, corpos, headers, cookies ou dados de tela.
export function safePath(url) { return new URL(url).pathname; }

// Aceita somente origem local: a sessao de teste nunca e enviada a outro host.
export function performanceBaseURL(value = process.env.PERF_BASE_URL ?? 'http://localhost:3000') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use somente uma origem localhost, sem credenciais, caminho ou consulta.');
  }
  return url.origin;
}

// Renova cookies no contexto isolado antes da medicao; nao salva nem registra tokens.
export async function preparePerformanceSession(context, baseURL = 'http://localhost:3000') {
  const response = await context.request.get(new URL('/api/auth/session', baseURL).href);
  if (!response.ok() || !(await response.json()).user) {
    throw new Error('Sessao expirada. Execute npm run perf:login novamente.');
  }
}

export async function waitForPageContent(page, timeoutMs = 120_000) {
  await page.locator(PAGE_CONTENT_SELECTOR).last().waitFor({ state: 'visible', timeout: timeoutMs });
}

export async function installObserver(page) {
  await page.addInitScript(() => {
    window.__erpPerf = { id: Math.random().toString(36), click: 0, longTasks: [] };
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href], button')) {
        window.__erpPerf.click = performance.now();
      }
    }, true);
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__erpPerf.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* Nem todo navegador oferece longtask. */ }
  });
}

export async function waitForScreen(page, pending, lastActivity, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let quietSince = performance.now();
  let previous = '';
  while (performance.now() < deadline) {
    if (/^\/(login|nao-autorizado|plano)(\/|$)/.test(safePath(page.url()))) {
      throw new Error('Redirecionado para login, plano ou acesso negado.');
    }
    const state = await page.evaluate((selector) => {
      const main = [...document.querySelectorAll(selector)].at(-1);
      if (!main) return null;
      const visible = (el) => {
        const style = getComputedStyle(el);
        return el.getClientRects().length > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0;
      };
      const loading = [...main.querySelectorAll('[aria-busy="true"], [role="status"], .animate-spin')]
        .some((el) => visible(el) && (el.matches('[aria-busy="true"], .animate-spin') || /carregando|buscando|aguarde/i.test(el.textContent ?? '')));
      // O texto e usado apenas para detectar estabilidade; nunca sai do navegador.
      const text = main.innerText;
      let hash = 0;
      for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
      return { signature: `${hash}:${main.querySelectorAll('*').length}`, ready: visible(main) && text.trim().length > 0 && !loading };
    }, PAGE_CONTENT_SELECTOR);
    const now = performance.now();
    if (!state?.ready || state.signature !== previous || pending.size || now - lastActivity() < 700) quietSince = now;
    previous = state?.signature ?? '';
    if (state?.ready && now - quietSince >= 700) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('Timeout: tela ou requisicoes nao estabilizaram.');
}

export async function findMenuLink(page, route) {
  const selector = `a[href=${JSON.stringify(route)}]`;
  if (safePath(page.url()) === '/pdv') {
    const exit = page.getByRole('button', { name: 'Sair do PDV', exact: true });
    if (route === '/historicovendas') return exit;
    // O PDV tem layout proprio, sem sidebar. Usa sua saida normal antes de
    // preparar o proximo link; esse preparo fica fora da medicao da proxima tela.
    await exit.click();
    await page.waitForURL((url) => url.pathname === '/historicovendas', { timeout: 45_000 });
    await waitForScreen(page, new Set(), () => 0, 45_000);
  }
  await page.locator('a[href]').first().waitFor({ state: 'attached', timeout: 15_000 });
  if (await page.locator('[data-slot="sidebar"][data-state="collapsed"]').count()) {
    await page.locator('[data-sidebar="trigger"]').first().click();
  }
  // Abrir os grupos revela links que o Radix desmonta enquanto fechado.
  // Reconsulta depois de cada expansao: .all() sobre aria-expanded=false cria
  // locators por indice que mudam de alvo quando um grupo sai desse conjunto.
  for (let attempt = 0; !(await page.locator(selector).count()) && attempt < 20; attempt++) {
    const button = page.locator('[data-sidebar="menu-button"][aria-expanded="false"]').first();
    if (!(await button.count())) break;
    await button.click({ timeout: 10_000 });
  }
  const link = page.locator(selector).first();
  if (!(await link.count())) throw new Error('Rota ausente do menu desta sessao.');
  return link;
}

export async function measureNavigation(page, route, { timeoutMs = 45_000, round = 1 } = {}) {
  const pending = new Set();
  const startedRequests = new Map();
  const requests = [];
  let last = performance.now();
  const origin = new URL(page.url()).origin;
  const relevant = (req) => {
    const url = new URL(req.url());
    return url.origin === origin && !BACKGROUND.test(url.pathname) && ['fetch', 'xhr', 'script', 'stylesheet', 'document'].includes(req.resourceType());
  };
  const start = (req) => {
    if (!relevant(req)) return;
    pending.add(req); startedRequests.set(req, performance.now()); last = performance.now();
  };
  const finish = (req, failed = false) => {
    if (!startedRequests.has(req)) return;
    const durationMs = Math.round(performance.now() - startedRequests.get(req));
    const cancelled = failed && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(req.failure()?.errorText ?? '');
    requests.push({ path: safePath(req.url()), type: req.resourceType(), startMs: Math.max(0, Math.round(startedRequests.get(req) - begin)), durationMs, failed, cancelled, status: null });
    // Response.status e sincrono depois de obter a resposta.
    const row = requests.at(-1);
    void req.response().then((res) => { row.status = res?.status() ?? null; }).catch(() => {});
    pending.delete(req); startedRequests.delete(req); last = performance.now();
  };
  const done = (req) => finish(req);
  const failed = (req) => finish(req, true);
  const link = await findMenuLink(page, route);
  const initialId = await page.evaluate(() => window.__erpPerf.id);
  page.on('request', start); page.on('requestfinished', done); page.on('requestfailed', failed);
  const begin = performance.now();
  const result = { route, fromRoute: safePath(page.url()), round, status: 'ok', urlMs: null, readyMs: null, longTaskMs: null, navigation: 'client', requests };
  let stage = 'click';
  try {
    // Espera estabilidade e hit target; force podia clicar outra linha durante
    // animacoes/scroll do menu, deixando a URL anterior por todos os 90s.
    await link.click({ timeout: timeoutMs });
    stage = 'url';
    await page.waitForURL((url) => url.pathname === route, { timeout: timeoutMs });
    result.urlMs = Math.round(performance.now() - begin);
    stage = 'screen';
    await waitForScreen(page, pending, () => last, timeoutMs);
    const timing = await page.evaluate((id) => {
      const state = window.__erpPerf;
      if (state.id !== id) return { reload: true, elapsed: null, tasks: null };
      return { reload: false, elapsed: performance.now() - state.click, tasks: state.longTasks.filter((e) => e.start >= state.click).reduce((sum, e) => sum + e.duration, 0) };
    }, initialId);
    result.navigation = timing.reload ? 'document' : 'client';
    result.readyMs = Math.round(timing.elapsed ?? (performance.now() - begin));
    result.longTaskMs = timing.tasks == null ? null : Math.round(timing.tasks);
    if (requests.some((r) => (r.failed && !r.cancelled) || r.status >= 400)) result.status = 'network-error';
  } catch (error) {
    result.status = 'error';
    result.readyMs = Math.round(performance.now() - begin);
    // Mensagens do Playwright podem incluir DOM/URLs: salvar apenas categoria.
    result.error = /Timeout|timeout/.test(error.message) ? 'timeout' : 'navigation-failed';
    result.stage = stage;
    result.actualPath = safePath(page.url());
  } finally {
    page.off('request', start); page.off('requestfinished', done); page.off('requestfailed', failed);
  }
  requests.sort((a, b) => b.durationMs - a.durationMs);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  if (args.includes('--help')) {
    console.log('npm run perf:login -- [--url=http://localhost:3000]\nnpm run perf:navigation -- [--routes=/dashboard,/ordens,/estoque] [--rounds=2] [--budget=5000] [--headed] [--url=http://localhost:3000]');
    return;
  }
  const base = new URL(option('url', 'http://localhost:3000'));
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Use um endereco localhost para este teste.');
  const login = args.includes('--login');
  const routes = option('routes', DEFAULT_ROUTES.join(',')).split(',');
  if (routes.length < 2 || routes.some((route) => !/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(route))) throw new Error('Informe pelo menos duas rotas locais, sem query string.');
  const rounds = Number(option('rounds', '2'));
  const budget = Number(option('budget', '5000'));
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20 || !Number.isFinite(budget) || budget <= 0) throw new Error('Rounds deve estar entre 1 e 20; budget deve ser positivo.');
  if (!login) {
    try { await access(AUTH_FILE); } catch { throw new Error('Primeiro execute npm run perf:login e faca login na janela aberta.'); }
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: !login && !args.includes('--headed') });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', ...(login ? {} : { storageState: AUTH_FILE }) });
    const page = await context.newPage();
    if (login) {
      await page.goto(new URL('/login', base).href, { timeout: 120_000 });
      console.log('Faca login na janela de teste do Edge. Aguardando ate 5 minutos; nenhuma senha e registrada pelo script.');
      await page.waitForURL((url) => url.origin === base.origin && !/^\/(login|recuperar-senha)(\/|$)/.test(url.pathname), { timeout: 300_000 });
      await waitForPageContent(page);
      const session = await context.request.get(new URL('/api/auth/session', base).href);
      if (!session.ok() || !(await session.json()).user) throw new Error('Sessao nao autenticada.');
      await mkdir(path.dirname(AUTH_FILE), { recursive: true });
      await context.storageState({ path: AUTH_FILE });
      console.log('Sessao salva localmente. Agora execute npm run perf:navigation.');
      return;
    }
    await preparePerformanceSession(context, base.origin);
    await installObserver(page);
    await page.goto(new URL(routes.at(-1), base).href, { timeout: 120_000, waitUntil: 'domcontentloaded' });
    if (safePath(page.url()) === '/login') throw new Error('Sessao expirada. Execute npm run perf:login novamente.');
    await waitForScreen(page, new Set(), () => 0, 90_000);
    const results = [];
    const output = path.resolve('artifacts/performance', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(output, { recursive: true });
    const report = { baseURL: base.origin, createdAt: new Date().toISOString(), budgetMs: budget, note: 'Primeira rodada nao garante cache frio. readyMs inclui janela de estabilidade de pelo menos 700ms. Nao mede apenas pintura ou compilacao.', results };
    const save = async () => {
      await writeFile(path.join(output, 'navigation.json'), JSON.stringify(report, null, 2));
      const lines = ['# Navegacao local', '', report.note, '', '| Rota | Rodada | URL (ms) | Pronta (ms) | Long tasks (ms) | Estado |', '| --- | ---: | ---: | ---: | ---: | --- |'];
      for (const r of results) lines.push(`| ${r.route} | ${r.round} | ${r.urlMs ?? '-'} | ${r.readyMs} | ${r.longTaskMs ?? '-'} | ${r.status} |`);
      for (const r of results.filter((row) => row.stage)) lines.push(`\nFalha em ${r.route}: etapa=${r.stage}, erro=${r.error}, rota atual=${r.actualPath}.`);
      lines.push('', '## Requisicoes mais lentas', '');
      for (const r of results) for (const req of r.requests.slice(0, 5)) lines.push(`- ${r.route} (${r.round}): ${req.path} — ${req.durationMs} ms, HTTP ${req.status ?? '-'}${req.failed ? ', falhou' : ''}`);
      await writeFile(path.join(output, 'navigation.md'), lines.join('\n') + '\n');
    };
    let consecutiveErrors = 0;
    outer: for (let round = 1; round <= rounds; round++) {
      for (const route of routes) {
        if (safePath(page.url()) === route) continue;
        let result;
        try { result = await measureNavigation(page, route, { round }); }
        catch (error) { result = { route, round, status: 'unavailable', stage: 'menu', error: /ausente do menu/.test(error.message) ? 'menu-link-missing' : 'menu-interaction-failed', actualPath: safePath(page.url()), readyMs: null, requests: [] }; }
        results.push(result);
        console.log(`${round} ${route}: ${result.readyMs ?? '-'} ms (${result.status}${result.stage ? `, etapa=${result.stage}, atual=${result.actualPath}` : ''})`);
        await save();
        if (/^\/login(\/|$)/.test(safePath(page.url()))) throw new Error('Sessao expirada durante o teste. Relatorio parcial salvo.');
        consecutiveErrors = ['error', 'unavailable'].includes(result.status) ? consecutiveErrors + 1 : 0;
        if (consecutiveErrors >= 3) {
          console.log('Interrompido apos 3 falhas consecutivas; consulte as etapas no relatorio.');
          break outer;
        }
      }
    }
    console.log(`Relatorios: ${output}`);
    if (!results.length || results.some((r) => r.status !== 'ok' || r.readyMs > budget)) process.exitCode = 1;
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
