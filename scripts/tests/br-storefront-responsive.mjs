// Browser layout checks against the local storefront. Account data is intercepted;
// no user is created and no checkout, card or customer data is written.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.BR_PREVIEW_URL || 'http://localhost:3011';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const artifacts = path.resolve('artifacts/br-storefront-responsive');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BR_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const widths = process.env.BR_REVIEW_WIDTHS?.split(',').map(Number) || [320,375,430,768,1280];
const viewportHeight = Number(process.env.BR_REVIEW_HEIGHT || 900);
const user = { id: '00000000-0000-4000-8000-000000000099', aud: 'authenticated', role: 'authenticated', email: 'responsive@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', user_metadata: { name: 'Cliente de verificação de responsividade' } };
const customer = { id: 999, user_id: user.id, nomerazaosocial: user.user_metadata.name, email: user.email, cpfcnpj: '11144477735', telefone: '83999990000', tipopessoa: 'FISICA' };
const address = { id: 999, cliente_id: 999, cep: '58108152', logradouro: 'Rua de verificação com nome comprido', numero: '146', complemento: 'Quadra 01 Lote 18', bairro: 'Renascer', cidade: 'Cabedelo', estado: 'PB', principal: true };
const product = { id: 258, titulo: 'Peça automotiva com descrição longa para verificar alinhamento em telas pequenas', referencia: 'REFERENCIA-TESTE-123456789', fabricante: 'Fabricante de teste', precovenda: 1250, preco_site: 1250, estoque: 5, conservacao: 'USADO' };
const order = { id: 999, clienteid: 999, status: 'PAGO', status_entrega: 'ENVIADO', canal: 'ONLINE', sub_total: 1250, valortotal: 1250, forma_pagamento: 'PIX', datavenda: '2026-10-20T12:00:00Z', createdat: '2026-10-20T12:00:00Z', codigo_rastreio: 'TESTE123456789BR', transportadora: 'Transportadora de verificação', url_rastreio: null, endereco_entrega_snapshot: address, cliente: customer };
const homeHtml = await (await fetch(base)).text();
const categoryPaths = [...new Set([...homeHtml.matchAll(/href="(\/categoria\/[^\"]+)"/g)].map(match => match[1]))];
for (const route of categoryPaths) assert.equal((await fetch(base + route)).status, 200, `Category link must work: ${route}`);
const publicRoutes = ['/', '/produtos', '/produtos?page=2', '/buscar?q=motor', '/produto/258', ...(categoryPaths[0] ? [categoryPaths[0]] : []), '/carrinho', '/login', '/registro', '/fale-conosco', '/rastreio', '/trocas-e-devolucoes', '/politica-de-privacidade', '/termos-de-uso', '/desmontagem-rastreada', '/admin'];
const accountRoutes = ['/conta', '/enderecos', '/pedidos', '/favoritos', '/conta/cartoes', '/conta/seguranca', '/checkout', '/sucesso?orderId=999', '/rastreio?codigo=999'];
const report = [];
const failures = [];

async function fixture(context, authenticated) {
  await context.route('**/*.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: user });
    if (!url.pathname.includes('/rest/v1/')) return route.abort();
    assert.equal(request.method(), 'GET', 'Review must never mutate the real store');
    const table = url.pathname.split('/').at(-1);
    const tables = { cliente: [customer], cliente_endereco: [address], favorito: [{ produto_id: 258 }], venda: [order],
      vendaproduto: [{ id: 999, venda_id: 999, produtoid: 258, quantidade: 1, valor_total: 1250, produto: { ...product, tituloMarketplace: product.titulo } }], order_fulfillment_event: [] };
    const data = tables[table] || [];
    await route.fulfill({ json: request.headers().accept?.includes('vnd.pgrst.object') ? data[0] || null : data });
  });
  await context.route(`${base}/api/**`, async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') return route.abort();
    if (url.pathname === '/api/account/cards') return route.fulfill({ json: { cards: [] } });
    if (url.pathname === '/api/pedidos/status') return route.fulfill({ json: { orderId: 999, status: 'PAGO', isPaid: true, isPending: false, isCancelled: false, total: 1250, paymentMethod: 'PIX' } });
    if (url.pathname === '/api/pedidos/999') return route.fulfill({ json: { success: true, order: { ...order, itens: [] } } });
    return route.continue();
  });
  await context.addInitScript(({ product }) => localStorage.setItem('br_pecas_cart_v1', JSON.stringify([{ produto: product, quantidade: 1 }])), { product });
  if (authenticated) {
    const expiry = Math.floor(Date.now()/1000) + 3600;
    const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: expiry, iat: expiry-3600 })).toString('base64url'), 'visual-test-only'].join('.');
    const session = { access_token: token, refresh_token: 'visual-test-only', token_type: 'bearer', expires_in: 3600, expires_at: expiry, user };
    await context.addCookies([{ name: 'sb-omicuflzwpajzainwboq-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: base, sameSite: 'Lax' }]);
  }
}

async function inspect(page, route, width, authenticated) {
  const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-storefront-shell]').waitFor();
  if (authenticated && ['/conta','/enderecos','/pedidos','/favoritos','/conta/cartoes','/conta/seguranca'].includes(route)) {
    await page.getByText(user.user_metadata.name, { exact: true }).first().waitFor({ timeout: 10000 });
  }
  if (route === '/checkout') await page.getByText(address.logradouro, { exact: false }).first().waitFor({ timeout: 10000 });
  if (route.startsWith('/sucesso')) await page.getByRole('heading', { name: 'Pagamento Confirmado!' }).waitFor();
  if (route.includes('/rastreio?')) await page.getByRole('heading', { name: 'Pedido #999', exact: true }).waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return { viewport: width, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(el => {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      return box.width > 0 && style.position !== 'fixed' && style.visibility !== 'hidden' && box.right > width + 1 && !el.closest('[data-nextjs-dialog], nextjs-portal') && !el.closest('.overflow-x-auto, .overflow-hidden');
    }).slice(0,8).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent?.slice(0,65) })) };
  });
  const result = { route, width, height: viewportHeight, authenticated, status: response.status(), finalPath: new URL(page.url()).pathname, ...overflow };
  report.push(result);
  if (response.status() >= 400 || overflow.scroll > width + 1 || (authenticated && new URL(page.url()).pathname === '/login')) failures.push(result);
  if (route === '/login' || route === '/registro') {
    assert.equal(await page.locator('header').count(), 0, 'Auth pages must have their own layout');
    assert.equal(await page.locator('footer').count(), 0);
  }
  if ([375,1280].includes(width) && ['/', '/login', '/registro', '/conta', '/checkout', '/carrinho', '/produto/258'].includes(route)) {
    await page.screenshot({ path: path.join(artifacts, `${width}-${route.replace(/\W+/g,'-') || 'home'}.png`), fullPage: true, animations: 'disabled' });
    if (route === '/') await page.screenshot({ path: path.join(artifacts, `${width}-home-viewport.png`), animations: 'disabled' });
  }
  if (route === '/enderecos' || route === '/conta/cartoes') {
    await page.getByRole('button', { name: route === '/enderecos' ? 'Novo endereço' : 'Novo cartão', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= -1 && box.width <= width + 1 && box.height <= viewportHeight + 1, `Dialog must fit ${width}px: ${route}`);
    if (width === 375) await page.screenshot({ path: path.join(artifacts, `${width}-${route.replace(/\W+/g,'-')}-dialog.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
  }
}

try {
  for (const width of widths) {
    for (const authenticated of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: viewportHeight }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768 });
      await fixture(context, authenticated);
      const page = await context.newPage();
      for (const route of authenticated ? accountRoutes : publicRoutes) await inspect(page, route, width, authenticated);
      if (!authenticated) {
        await page.goto(base + '/produtos');
        const search = page.locator('[data-slot="input-group-control"]:visible');
        await search.fill('motor');
        const button = page.getByRole('button', { name: 'Pesquisar', exact: true }).filter({ visible: true });
        const group = await page.locator('[data-slot="input-group"]:visible').boundingBox(), box = await button.boundingBox();
        assert.ok(Math.abs((group.y+group.height/2)-(box.y+box.height/2)) <= 1, 'Search button must be vertically centered');
        await button.click();
        await page.waitForURL('**/buscar?q=motor');
        await page.goto(base + '/produtos');
        await page.getByRole('combobox', { name: 'Ordenar produtos' }).click();
        assert.equal(await page.locator('[data-slot="select-content"]').count(), 1);
        await page.keyboard.press('Escape');
        await page.getByTitle('Carrinho de Compras').click();
        await page.getByRole('dialog').waitFor();
        const drawer = await page.getByRole('dialog').boundingBox();
        assert.ok(drawer.x >= -1 && drawer.width <= width + 1, 'Cart drawer must fit viewport');
        await page.keyboard.press('Escape');
        if (width < 1024) {
          await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
          assert.equal(await page.locator('#mobile-menu').isVisible(), true);
          await page.getByRole('button', { name: 'Fechar menu', exact: true }).click();
        }
      }
      await context.close();
    }
    console.log(`Checked ${width}px.`);
  }
} finally {
  await writeFile(path.join(artifacts, process.env.BR_REVIEW_HEIGHT ? `report-height-${viewportHeight}.json` : 'report.json'), JSON.stringify({ report, failures }, null, 2));
  await browser.close();
}
console.log(`${report.length} page/viewport checks; ${failures.length} layout failures.`);
if (failures.length) { console.log(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
