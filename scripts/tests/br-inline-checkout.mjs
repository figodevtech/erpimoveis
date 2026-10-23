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


try {
 for(const width of [375,1280]) for(const method of ['PIX','BOLETO','CREDIT_CARD']) {
  const context=await browser.newContext({viewport:{width,height:900},permissions:['clipboard-read','clipboard-write']});
  await fixture(context,true);
  let posted=null, paid=false;
  await context.route(`${base}/api/**`, async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/checkout/attempt') return route.fulfill({status:404,json:{message:'No previous attempt'}});
    if(url.pathname==='/api/checkout') {
      posted=route.request().postDataJSON();
      assert.equal(posted.transparent,true);assert.equal(posted.billingType,method);
      if(method==='CREDIT_CARD')assert.equal(posted.card.number,'4111111111111111');
      return route.fulfill({json:{orderId:999,directPayment:true,transparent:true,url:'https://example.test/do-not-navigate'}});
    }
    if(url.pathname==='/api/checkout/payment-details')return route.fulfill({json: method==='PIX'? {pix:{encodedImage:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',payload:'pix-test-code'}}:{boleto:{line:'1234567890',url:'https://example.test/boleto'},dueDate:'2035-12-01'}});
    if(url.pathname==='/api/pedidos/status')return route.fulfill({json:{orderId:999,isPaid:paid,status:paid?'PAGO':'PENDENTE'}});
    return route.fallback();
  });
  const page=await context.newPage();await page.goto(base+'/checkout');
  await page.getByText(address.logradouro,{exact:false}).first().waitFor();
  assert.equal(await page.locator('[id^="payment-"][role="radio"][data-state="checked"]').count(),0,'Payment method must start unselected');
  const paymentButton=page.getByRole('button',{name:'Escolha como pagar'}).filter({visible:true});
  assert.equal(await paymentButton.isDisabled(),true,'Payment requires an explicit choice');
  await page.locator(`#payment-${method}`).click();
  if(method==='CREDIT_CARD'){
    await page.locator('#checkout-holderName').fill('TEST USER');await page.locator('#checkout-number').fill('4111111111111111');
    await page.locator('#checkout-expiryMonth').fill('12');await page.locator('#checkout-expiryYear').fill('2035');await page.locator('#checkout-ccv').fill('123');
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:/Pagar com/}).filter({visible:true}).click();
  await page.getByRole('button',{name:/realizei o pagamento/}).waitFor();
  assert.ok(posted);assert.equal(new URL(page.url()).pathname,'/checkout');assert.equal(context.pages().length,1);
  if(method==='PIX')await page.locator('#pix-code').waitFor();
  if(method==='BOLETO')await page.locator('#boleto-line').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('4111111111111111')),false);
  await page.screenshot({path:path.join(artifacts,`inline-${method}-${width}.png`),fullPage:true});
  paid=true;await page.getByRole('button',{name:/realizei o pagamento/}).click();
  await page.getByRole('heading',{name:'Pagamento Confirmado!'}).waitFor();
  console.log(`PASS ${method} ${width}px: inline payment, no navigation, authoritative confirmation`);
  await context.close();
 }
}finally{await browser.close()}
