import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { installObserver, measureNavigation, safePath, waitForPageContent, findMenuLink, preparePerformanceSession, performanceBaseURL } from './navigation.mjs';

test('remove consultas e fragmentos dos caminhos registrados', () => {
  assert.equal(safePath('http://localhost:3000/api/products?search=dado-privado#token'), '/api/products');
});

test('mede navegacao SPA, espera API lenta e sinaliza erro HTTP sem gravar dados', { timeout: 30_000 }, async () => {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/cancel')) {
      setTimeout(() => res.end('cancelado'), 150);
      return;
    }
    if (req.url.startsWith('/api/data')) {
      setTimeout(() => {
        res.writeHead(req.url.includes('fail=1') ? 500 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ value: 'conteudo-privado-nao-deve-sair' }));
      }, 350);
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><body>
      <nav><a href="/a">A</a><a href="/b">B</a><a href="/error">Erro</a></nav>
      <button onclick="history.pushState({}, '', '/historicovendas'); document.querySelector('#content').textContent = 'Historico';">Sair do PDV</button>
      <main data-slot="sidebar-inset">
        <header><p role="status">Carregando recurso do cabecalho...</p></header>
        <main id="content">Pagina A</main>
      </main>
      <script>document.querySelectorAll('a').forEach(a => a.addEventListener('click', async e => {
        e.preventDefault(); history.pushState({}, '', a.getAttribute('href'));
        document.querySelector('#content').innerHTML = '<p role="status">Carregando...</p>';
        const controller = new AbortController();
        fetch('/api/cancel', { signal: controller.signal }).catch(() => {});
        setTimeout(() => controller.abort(), 30);
        const r = await fetch('/api/data?search=segredo&fail=' + (a.pathname === '/error' ? '1' : '0'));
        await r.json(); document.querySelector('#content').textContent = 'Pagina pronta ' + a.pathname;
      }));</script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    await installObserver(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/a`);
    assert.equal(await page.locator('main').count(), 2);
    // Reproduz o layout real: login nao deve falhar por seletor ambiguo e o
    // carregamento permanente do cabecalho nao deve bloquear a tela interna.
    await waitForPageContent(page, 1500);
    const result = await measureNavigation(page, '/b', { timeoutMs: 6000 });
    assert.equal(result.status, 'ok');
    assert.equal(result.navigation, 'client');
    assert.ok(result.requests.some((r) => r.cancelled));
    assert.ok(result.readyMs >= 1000, `API lenta e estabilidade devem entrar no tempo: ${result.readyMs}`);
    assert.ok(result.requests.some((r) => r.path === '/api/data' && r.durationMs >= 300 && r.status === 200));
    assert.ok(!JSON.stringify(result).includes('segredo'));
    assert.ok(!JSON.stringify(result).includes('conteudo-privado'));
    const error = await measureNavigation(page, '/error', { timeoutMs: 6000 });
    assert.equal(error.status, 'network-error');
    assert.equal(error.requests[0].status, 500);
    await assert.rejects(() => measureNavigation(page, '/missing'), /ausente do menu/);
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        const button = document.createElement('button');
        button.dataset.sidebar = 'menu-button';
        button.setAttribute('aria-expanded', 'false');
        button.textContent = `Grupo ${i}`;
        button.onclick = () => {
          button.setAttribute('aria-expanded', 'true');
          if (i === 2) {
            const link = document.createElement('a');
            link.href = '/nested'; link.textContent = 'Modulo aninhado';
            document.querySelector('nav').append(link);
          }
        };
        document.querySelector('nav').append(button);
      }
    });
    const nested = await findMenuLink(page, '/nested');
    assert.equal(await nested.getAttribute('href'), '/nested');
    assert.equal(await page.locator('button[aria-expanded="true"]').count(), 3);
    await page.goto(`http://127.0.0.1:${server.address().port}/pdv`);
    const exit = await measureNavigation(page, '/historicovendas', { timeoutMs: 6000 });
    assert.equal(exit.status, 'ok');
    assert.equal(exit.fromRoute, '/pdv');
    assert.equal(exit.navigation, 'client');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('prepara sessao antes das medicoes e rejeita sessao ausente', async () => {
  let requested;
  const context = { request: { get: async (url) => {
    requested = url;
    return { ok: () => true, json: async () => ({ user: { id: 'teste' } }) };
  } } };
  await preparePerformanceSession(context, 'http://localhost:3000');
  assert.equal(requested, 'http://localhost:3000/api/auth/session');
  await assert.rejects(preparePerformanceSession({ request: { get: async () => ({ ok: () => true, json: async () => ({}) }) } }), /Sessao expirada/);
  await assert.rejects(preparePerformanceSession({ request: { get: async () => ({ ok: () => false }) } }), /Sessao expirada/);
});

test('origem de teste aceita portas locais e rejeita destinos externos ou credenciais', () => {
  assert.equal(performanceBaseURL('http://localhost:3001/'), 'http://localhost:3001');
  assert.equal(performanceBaseURL('http://127.0.0.1:3002'), 'http://127.0.0.1:3002');
  for (const url of ['https://example.com', 'http://localhost.evil.test', 'http://user:pass@localhost:3001', 'http://localhost:3001/path', 'http://localhost:3001/?token=abc', 'file:///tmp/test']) {
    assert.throws(() => performanceBaseURL(url));
  }
});
