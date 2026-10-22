// Simulates customer actions locally. All database writes and payments are mocked.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base='http://localhost:3015';
const user={id:'00000000-0000-4000-8000-000000000099',aud:'authenticated',role:'authenticated',email:'checkout@example.test',user_metadata:{name:'Cliente de teste'}};
const customer={id:999,user_id:user.id,nomerazaosocial:'Cliente de teste',email:user.email,cpfcnpj:'11144477735',telefone:'83999990000',tipopessoa:'FISICA'};
const address={id:999,cliente_id:999,cep:'58108152',logradouro:'Rua de teste',numero:'10',bairro:'Centro',cidade:'Cabedelo',estado:'PB'};
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
 for(const width of [375,1280]) for(const method of ['PIX','BOLETO','CREDIT_CARD']) {
  const context=await browser.newContext({viewport:{width,height:900}});
  let paid=false,posts=0;
  await context.route('**/*.supabase.co/**',route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/auth/v1/user'))return route.fulfill({json:user});
   assert.equal(req.method(),'GET','Never write to the live database');
   const table=url.pathname.split('/').at(-1);
   const rows=table==='cliente'?[customer]:table==='cliente_endereco'?[address]:[];
   return route.fulfill({json:req.headers().accept?.includes('vnd.pgrst.object')?rows[0]||null:rows});
  });
  await context.route(`${base}/api/**`,route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/api/account/cards')return route.fulfill({json:{cards:[]}});
   if(url.pathname==='/api/checkout/attempt')return route.fulfill({status:404,json:{message:'No previous attempt'}});
   if(url.pathname==='/api/checkout'){
    posts++;const body=req.postDataJSON();
    assert.equal(body.billingType,method);assert.equal(body.addressId,999);
    assert.match(body.checkoutAttemptId,/^[a-f0-9-]{36}$/i);
    assert.deepEqual(body.items,[{productId:'224',quantity:1}]);
    return route.fulfill({json:{orderId:999,url:`${base}/mock-payment`}});
   }
   if(url.pathname==='/api/pedidos/status')return route.fulfill({json:{orderId:999,isPaid:paid,status:paid?'PAGO':'PENDENTE'}});
   assert.equal(req.method(),'GET','Unexpected mutation blocked');
   return route.fulfill({json:{}});
  });
  await context.route(`${base}/mock-payment`,route=>route.fulfill({contentType:'text/html',body:'<p>Pagamento simulado</p>'}));
  const expiry=Math.floor(Date.now()/1000)+3600;
  const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,aud:'authenticated',role:'authenticated',exp:expiry,iat:expiry-3600})).toString('base64url'),'test-only'].join('.');
  await context.addCookies([{name:'sb-ohlylsxvvughgedgcimg-auth-token',value:'base64-'+Buffer.from(JSON.stringify({access_token:token,refresh_token:'test-only',token_type:'bearer',expires_in:3600,expires_at:expiry,user})).toString('base64url'),url:base,sameSite:'Lax'}]);
  await context.addInitScript(()=>{
   // Seed once, so clearing the cart after confirmation remains observable.
   if(!sessionStorage.getItem('fixture-seeded')){
    localStorage.setItem('demirdiesel-cart',JSON.stringify([{product:{id:'224',name:'Produto de teste',title:'Produto de teste',price:4500,stock:1},quantity:1}]));
    sessionStorage.setItem('fixture-seeded','yes');
   }
  });
  const page=await context.newPage();await page.goto(base+'/checkout');
  await page.getByText('Rua de teste, 10',{exact:false}).first().waitFor();
  await page.locator(`#payment-${method}`).click();
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:/Pagar com/}).filter({visible:true}).click();
  const popup=await popupPromise;await popup.waitForURL(`${base}/mock-payment`);
  assert.equal(posts,1);assert.equal(new URL(page.url()).pathname,'/checkout');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:/realizei o pagamento/}).click();
  assert.equal(await page.getByRole('heading',{name:'Pagamento Confirmado!'}).count(),0,'Unpaid attempt must not show success');
  paid=true;
  await page.getByRole('button',{name:/realizei o pagamento/}).click();
  await page.getByRole('heading',{name:'Pagamento Confirmado!'}).waitFor();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('demirdiesel-cart')||'[]').length===0);
  console.log(`PASS Demir ${method} ${width}px: sanitized checkout, hosted payment, pending stays pending, paid confirmation clears cart`);
  await context.close();
 }
}finally{await browser.close();}
