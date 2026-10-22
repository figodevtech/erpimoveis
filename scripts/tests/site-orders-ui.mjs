import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const user={id:'00000000-0000-4000-8000-000000000099',aud:'authenticated',role:'authenticated',email:'review@example.test',email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{name:'Cliente de teste'}};
const customer={id:999,user_id:user.id,nomerazaosocial:'Cliente de teste',email:user.email,cpfcnpj:'11144477735',telefone:'83999990000',tipopessoa:'FISICA'};
const paid={id:999,clienteid:999,status:'PAGO',status_entrega:'ENVIADO',canal:'ONLINE',valortotal:1250,datavenda:'2026-10-22T12:00:00Z',createdat:'2026-10-22T12:00:00Z',codigo_rastreio:'TESTE123456789BR',transportadora:'Transportadora de teste',url_rastreio:'https://example.test/tracking',nfe_numero:'123',nfe_serie:'1',nfe_chave_acesso:'1'.repeat(44),danfe_url:'https://example.test/danfe',endereco_entrega_snapshot:{deliveryMethod:'pickup',pickupAddress:'Loja de teste'},separacao_em:'2026-10-22T12:00:00Z',faturado_em:'2026-10-22T13:00:00Z',enviado_em:'2026-10-22T14:00:00Z'};
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 for(const {site,base,ref} of [{site:'BR',base:'http://localhost:3011',ref:'omicuflzwpajzainwboq'},{site:'Demir',base:'http://localhost:3015',ref:'ohlylsxvvughgedgcimg'}]){
  for(const width of [375,1280]){
   const context=await browser.newContext({viewport:{width,height:900}});
   let queried=false;
   await context.route('**/*.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname.endsWith('/auth/v1/user'))return route.fulfill({json:user});
    if(!url.pathname.includes('/rest/v1/'))return route.abort();
    assert.equal(req.method(),'GET','browser verification must never mutate data');
    const table=url.pathname.split('/').at(-1);
    if(table==='venda'){assert.equal(url.searchParams.get('status'),'eq.PAGO');assert.equal(url.searchParams.get('clienteid'),'eq.999');queried=true;}
    const data=table==='cliente'?[customer]:table==='venda'?[paid]:table==='vendaproduto'?[{id:99,venda_id:999,quantidade:2,valor_total:1250,produto:{titulo:'Produto de teste',tituloMarketplace:'Produto de teste',fabricante:'Fabricante de teste'}}]:[];
    return route.fulfill({json:req.headers().accept?.includes('vnd.pgrst.object')?data[0]||null:data});
   });
   await context.route(`${base}/api/**`,route=>route.request().method()==='GET'?route.fulfill({json:{}}):route.abort());
   const expiry=Math.floor(Date.now()/1000)+3600;
   const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,aud:'authenticated',role:'authenticated',exp:expiry,iat:expiry-3600})).toString('base64url'),'test-only'].join('.');
   await context.addCookies([{name:`sb-${ref}-auth-token`,value:'base64-'+Buffer.from(JSON.stringify({access_token:token,refresh_token:'test-only',token_type:'bearer',expires_in:3600,expires_at:expiry,user})).toString('base64url'),url:base,sameSite:'Lax'}]);
   const page=await context.newPage();await page.goto(base+'/pedidos');
   await page.getByRole('button',{name:/Pedido #999/}).click();
   for(const text of ['Acompanhamento do pedido','Itens do Pedido (1)','Produto de teste','Retirada no local','TESTE123456789BR'])await page.getByText(text,{exact:true}).first().waitFor();
   await page.getByRole('link',{name:/Abrir DANFE/}).waitFor();
   await page.getByRole('link',{name:/Acompanhar entrega/}).waitFor();
   assert.ok(queried);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   console.log(`PASS ${site} ${width}px: paid orders only, ownership, items, timeline, invoice, pickup and tracking; no horizontal overflow`);
   await context.close();
  }
 }
}finally{await browser.close();}
