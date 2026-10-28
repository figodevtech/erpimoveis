import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
test('the shared inventory core is identical in the two independent storefronts',()=>{
 function walk(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(`${directory}/${item.name}`):[`${directory}/${item.name}`]);}
 for(const source of [...walk('storefront-template/lib'),...walk('storefront-template/app')]){
  const relative=source.replace('storefront-template/','');
  for(const site of ['site_brpecaspb','site_demirdiesel'])assert.equal(fs.readFileSync(`${site}/${relative}`,'utf8').replace(/\r\n/g,'\n'),fs.readFileSync(source,'utf8').replace(/\r\n/g,'\n'),`${site}/${relative} drifted`);
 }
});
function load(file,mocks={},extra={}) {
 const exports={};
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{exports,Buffer,URL,URLSearchParams,AbortSignal,Request,Response,Date,console,process:{env:{}},require(name){
  if(name in mocks)return mocks[name];
  if(name==='server-only')return {};
  if(name==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
  return require(name);
 },...extra});
 return exports;
}

test('ERP middleware lets storefront policy reads reach Bearer validation but keeps writes private',async()=>{
 const middleware=load('src/middleware.ts',{
  'next/server':require('next/server'),
  '@/lib/auth-edge':{auth:handler=>handler},
  '@/app/api/_authz/permission-constants':{PERMS:{},TIPO_PERMISSIONS:[]},
  '@/app/api/_authz/tipos-permission':{},
  '@/app/api/_authz/default-route':{},
  '@/app/api/_authz/action-permission':{},
  '@/lib/shared-lookup':{createSharedLookup:()=>()=>{throw Error('Public request must not query sessions');}},
 }).default;
 const {NextRequest}=require('next/server');
 for(const [method,path,expected] of [
  ['GET','checkout-config',200],['PUT','checkout-config',401],
  ['POST','checkout-config',401],['GET','checkout-config/other',401],
 ]){
  const response=await middleware(new NextRequest(`https://erp.test/api/integracoes/site/${path}?ids=9`,{method,headers:{Authorization:'Bearer own-store'}}));
  assert.equal(response.status,expected,`${method} ${path}`);
  if(expected===200)assert.equal(response.headers.get('x-middleware-next'),'1');
 }
});

test('installment preview distinguishes an unpublished storefront route from invalid Asaas credentials',async()=>{
 const fees={operationValue:.49,one:2,six:3,twelve:4};
 for(const [upstream,expected,pattern] of [[new Response('not found',{status:404}),503,/Publique a atualização do site/],[Response.json({feesError:'ASAAS_UNAUTHORIZED'},{status:503}),503,/chave de API/],[Response.json({fees}),200,null]]){
  const endpoint=load('src/app/api/integracoes/site/checkout-fees/route.ts',{
   '@/app/api/_authz/perms':{requireEstoqueAccess:async()=>{}},
   '@/lib/empresa-context':{requireEmpresaId:async()=>1,errorStatus:(_error,fallback)=>fallback},
   '@/lib/integrations/storefront-http':{storefrontFetch:async url=>{const parsed=new URL(url);assert.equal(parsed.host,'own-store.test');assert.equal(parsed.searchParams.get('includeFees'),'1');return upstream;}},
  },{process:{env:{STOREFRONT_API_URL:'https://own-store.test'}}});
  const response=await endpoint.GET(new Request('https://erp.test/api/integracoes/site/checkout-fees?productId=9'));
  assert.equal(response.status,expected);const result=await response.json();if(pattern)assert.match(result.message,pattern);else assert.deepEqual(result.fees,fees);
 }
});

test('explicit Asaas fee consultation does not turn provider failures into an empty successful response',async()=>{
 class AsaasApiError extends Error{constructor(status){super('private provider detail');this.status=status;}}
 const endpoint=load('storefront-template/app/api/checkout/options/route.ts',{
  '@/lib/erp-checkout-policy':{getCheckoutPolicy:async()=>({policies:{9:{feeMode:'absorbed'}}})},
  '@/lib/asaas-fees':{getCardFees:async()=>{throw new AsaasApiError(401);}},
  '@/lib/asaas':{AsaasApiError},
 });
 const response=await endpoint.GET(new Request('https://store.test/api/checkout/options?ids=9&includeFees=1'));
 assert.equal(response.status,503);const body=await response.json();assert.equal(body.feesError,'ASAAS_UNAUTHORIZED');assert.equal(JSON.stringify(body).includes('private provider detail'),false);
});

test('group payment rules are inherited while individual overrides and packaging remain independent',()=>{
 const policy=load('src/lib/integrations/site-checkout-policy.ts');
 const {resolveCheckoutPolicy,paymentFields}=load('src/lib/integrations/site-checkout-inheritance.ts',{'./site-checkout-policy':policy});
 const pack={weight:1,width:20,height:10,length:30};
 const individual={policy:{...policy.defaultCheckoutPolicy,maxInstallments:2,shippingPackage:pack},payment_override:true};
 const group={policy:{maxInstallments:6,minimumInstallment:20,interestFreeInstallments:3,feeMode:'incremental',monthlyInterestPercent:0}};
 assert.equal(resolveCheckoutPolicy(undefined,group).policy.maxInstallments,6);
 assert.equal(resolveCheckoutPolicy(individual,group).policy.maxInstallments,2);
 const inherited=resolveCheckoutPolicy({...individual,payment_override:false},group);
 assert.equal(inherited.policy.maxInstallments,6);assert.deepEqual(inherited.policy.shippingPackage,pack);
 assert.equal(inherited.source,'group');assert.equal(inherited.paymentOverride,false);
 assert.equal(resolveCheckoutPolicy(undefined,undefined).policy.maxInstallments,1);
 assert.equal(resolveCheckoutPolicy({...individual,payment_override:false},undefined).policy.maxInstallments,1);
 assert.equal('shippingPackage' in paymentFields(individual.policy),false,'shipping must never become a group rule');
});

test('store checkout resolves current group membership and ignores caller-supplied preview groups',async()=>{
 const policy=load('src/lib/integrations/site-checkout-policy.ts');
 const inheritance=load('src/lib/integrations/site-checkout-inheritance.ts',{'./site-checkout-policy':policy});
 const tables={
  produto:[{id:9,grupo_produto_id:2},{id:10,grupo_produto_id:2}],
  produtogrupo:[{id:2,nome:'Motor'}],
  site_group_checkout_config:[{grupo_id:2,policy:{...policy.defaultCheckoutPolicy,maxInstallments:6},updated_at:'a'}],
  site_product_checkout_config:[{produto_id:9,policy:policy.defaultCheckoutPolicy,payment_override:true,updated_at:'b'}],
  empresa:[{id:1,cep:'58000000'}],
 };
 const admin={from(table){let rows=tables[table]||[];return {select(){return this;},in(key,values){rows=rows.filter(row=>values.includes(row[key]));return this;},eq(key,value){rows=rows.filter(row=>row[key]===value);return this;},maybeSingle:async()=>({data:rows[0]||null,error:null}),then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve);}};}};
 const endpoint=load('src/app/api/integracoes/site/checkout-config/route.ts',{
  '@/app/api/_authz/perms':{requireEstoqueAccess:async()=>{}},
  '@/lib/empresa-context':{requireEmpresaId:async()=>1,errorStatus:()=>500},
  '@/lib/supabaseAdmin':{supabaseAdmin:admin},
  '@/lib/integrations/site-checkout-policy':policy,
  '@/lib/integrations/site-checkout-inheritance':inheritance,
 },{process:{env:{STOREFRONT_ORDER_SYNC_SECRET:'own-store'}}});
 const request=()=>new Request('https://erp.test/api/integracoes/site/checkout-config?ids=9,10&previewGroupId=999',{headers:{Authorization:'Bearer own-store'}});
 assert.equal((await endpoint.GET(new Request('https://erp.test/api/integracoes/site/checkout-config?ids=9',{headers:{Authorization:'Bearer wrong-store'}}))).status,401);
 const first=await (await endpoint.GET(request())).json();
 assert.equal(first.policies['9'].maxInstallments,1);assert.equal(first.policies['10'].maxInstallments,6);
 tables.site_group_checkout_config[0].policy.maxInstallments=3;tables.site_group_checkout_config[0].updated_at='c';
 const changed=await (await endpoint.GET(request())).json();
 assert.equal(changed.policies['10'].maxInstallments,3);assert.notEqual(first.revision,changed.revision);
 tables.produto[1].grupo_produto_id=null;
 const removed=await (await endpoint.GET(request())).json();assert.equal(removed.policies['10'].maxInstallments,1);
});
test('ERP order view requires the tenant secret and returns only sanitized checkout details',async()=>{
 const calls=[];
 const query={then(resolve){return Promise.resolve({data:[{order_id:12,phase:'BOUND',billing_type:'PIX',payment_id:'private-id',payment_data:{status:'PENDING',url:'private-url',dueDate:'2026-10-25'},checkout_payload:{total:50,items:[{produtoid:22,quantidade:2,valor_total:50}],address:{}},created_at:'2026-10-22',cliente:{nomerazaosocial:'Cliente'},payment_meta:{secret:'never-expose'}}],error:null}).then(resolve);}};
 for(const method of ['select','not','neq','order','range'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
 const endpoint=load('storefront-template/app/api/integrations/erp/checkout/reconcile/route.ts',{
  '@/lib/supabase/admin':{supabaseAdmin:{from(table){return table==='produto'?{select(){return {in:async()=>({data:[{id:22,titulo:'Produto de teste',referencia:'REF22'}],error:null})}}}:query;}}},
  '@/lib/checkout-reconcile':{reconcileCheckoutBatch:async()=>{throw Error('Read must not reconcile');}},
 },{process:{env:{ERP_ORDER_SYNC_SECRET:'tenant-secret'}}});
 const request=token=>new Request('https://store.test/api/integrations/erp/checkout/reconcile?view=orders&offset=100',{headers:{Authorization:`Bearer ${token}`}});
 assert.equal((await endpoint.GET(request('wrong'))).status,401);
 assert.equal(calls.length,0);
 const response=await endpoint.GET(request('tenant-secret'));
 const result=await response.json();
 assert.equal(result.data[0].dueDate,'2026-10-25');assert.equal(result.data[0].items[0].title,'Produto de teste');assert.equal(result.data[0].items[0].reference,'REF22');
 assert.equal(result.data[0].orderId,12);assert.equal(result.data[0].customer.name,'Cliente');
 assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['not','payment_id','is',null])));
 assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(['range',100,199])));
 assert.equal(JSON.stringify(result).includes('private-'),false);
 assert.equal(JSON.stringify(result).includes('never-expose'),false);
});
test('ERP checkout authenticates before database/tenant lookup and accepts only declared actions',async()=>{
 let calls=0;
 const endpoint=()=>load('src/app/api/integracoes/site/checkout/route.ts',{
  '@/lib/supabaseAdmin':{supabaseAdmin:{rpc:async()=>{calls++;return {data:[],error:null};}}},
  '@/lib/empresa-context':{requireEmpresaId:async()=>1},
 },{process:{env:{STOREFRONT_ORDER_SYNC_SECRET:'orders'}}});
 const req=(body,token)=>new Request('https://erp.test/api/integracoes/site/checkout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 for(const token of ['','wrong'])assert.equal((await endpoint().POST(req({action:'release',orderId:1,reason:'x'},token))).status,401);
 assert.equal(calls,0);
 assert.equal((await endpoint().POST(req({action:'arbitrary_sql',sql:'bad'},'orders'))).status,400);
 assert.equal(calls,0);
 assert.equal((await endpoint().POST(req({action:'availability',ids:[1]},'orders'))).status,200);
 assert.equal(calls,1);
});
test('public stock proxy never forwards reservation actions, prices or arbitrary caller fields',async()=>{
 let forwarded;
 const endpoint=load('storefront-template/app/api/stock/route.ts',{'@/lib/erp-checkout':{InventoryError:class extends Error{},erpCheckout:async body=>{forwarded=body;return [{productId:1,available:2,price:123,private:'hidden'}];}}});
 const response=await endpoint.POST(new Request('https://store.test/api/stock',{method:'POST',body:JSON.stringify({ids:[1],action:'release',orderId:5,secret:'wrong'})}));
 assert.equal(response.status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(forwarded)),{action:'availability',ids:[1]});
 assert.deepEqual(await response.json(),{items:[{productId:1,available:2}]});
});
test('ERP URL reuses existing order webhook configuration; network failure closes checkout',async()=>{
 let target,body;
 const {erpCheckout}=load('storefront-template/lib/erp-checkout.ts',{}, {process:{env:{ERP_ORDER_WEBHOOK_URL:'https://erp.client.test/api/integracoes/site/webhook',ERP_ORDER_SYNC_SECRET:'same-secret'}},fetch:async(url,init)=>{target=String(url);body=JSON.parse(init.body);assert.equal(init.headers.Authorization,'Bearer same-secret');assert.equal(init.redirect,'error');return Response.json({data:{reserved:true}});}});
 await erpCheckout({action:'reserve',orderId:1});
 assert.equal(target,'https://erp.client.test/api/integracoes/site/checkout');assert.equal(body.orderId,1);
 const unavailable=load('storefront-template/lib/erp-checkout.ts',{}, {process:{env:{}},fetch:()=>{throw Error('unexpected fetch');}});
 await assert.rejects(unavailable.erpCheckout({action:'reserve'}),/temporariamente indisponível/);
});
function reconcileFixture({phase='BOUND',billing='PIX',status='PENDING',age=120000,deleted=false,cancelledAt=null,list,deleteSucceeds=false,now=Date.parse('2026-10-21T15:00:00Z')}={}) {
 const attempt={order_id:10,phase,billing_type:billing,payment_id:list?null:'pay_test',expected_customer:'cus_test',created_at:new Date(now-age).toISOString(),bank_cancelled_at:cancelledAt};
 const payment={id:'pay_test',customer:'cus_test',externalReference:'10',billingType:billing,value:10,status,deleted};
 const updates=[],rpcs=[],requests=[],notifications=[];
 const db={from(table){return {select(){return this;},eq(){return this;},single:async()=>({data:{status:'PENDENTE'},error:null}),maybeSingle:async()=>({data:table==='checkout_attempt'?attempt:null,error:null}),update(data){updates.push(data);return this;},then(resolve){return Promise.resolve({data:null,error:null}).then(resolve);}};},rpc:async(name,args)=>{rpcs.push([name,args]);return {data:false,error:null};}};
 class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const api=load('storefront-template/lib/checkout-reconcile.ts',{
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/asaas':{getAsaasPayment:async()=>payment,cancelAsaasPayment:async()=>{requests.push(['/payments/pay_test',{method:'DELETE'}]);if(!deleteSucceeds)throw Error('unexpected provider mutation');payment.deleted=true;return payment;},asaasRequest:async(path,init)=>{requests.push([path,init]);if(list)return list;if(deleteSucceeds&&init?.method==='DELETE'){payment.deleted=true;return {deleted:true};}throw Error('unexpected provider mutation');}},
  '@/lib/erp-checkout':{erpCheckout:async()=>true},
  '@/lib/checkout-attempt':{bindCheckoutPayment:async()=>true,releaseCancelledCheckout:async()=>{requests.push(['release']);}},
 },{Date:FixedDate,fetch:async(_url,init)=>{notifications.push(init);return Response.json({ok:true});},process:{env:{ERP_ORDER_WEBHOOK_URL:'https://erp.test/webhook',ERP_ORDER_SYNC_SECRET:'orders'}}});
 return {api,payment,updates,rpcs,requests,notifications};
}
test('boleto settlement margin skips weekends, national holidays and bank closure days',()=>{
 const {api}=reconcileFixture();
 assert.equal(new Date(api.bankSettlementDeadline('2026-10-23T12:00:00Z')).toISOString(),'2026-10-29T03:00:00.000Z');
 assert.equal(new Date(api.bankSettlementDeadline('2026-11-18T12:00:00Z')).toISOString(),'2026-11-25T03:00:00.000Z');
 assert.equal(api.bankSettlementDeadline('invalid'),Infinity);
});
test('overdue boleto and a bank cancellation event never immediately release inventory',async()=>{
 for(const deleted of [false,true]){
 const f=reconcileFixture({billing:'BOLETO',status:'OVERDUE',age:10*86400000,deleted});
 await f.api.reconcileCheckout(10,f.payment,'PAYMENT_BANK_SLIP_CANCELLED');
 assert.equal(f.requests.length,0);assert.equal(f.rpcs.length,0);assert.ok(f.updates.some(x=>x.bank_cancelled_at));
 }
});
test('payment reported after boleto due date confirms the reserved order',async()=>{
 const f=reconcileFixture({billing:'BOLETO',status:'CONFIRMED',age:10*86400000});
 await f.api.reconcileCheckout(10,f.payment);
 assert.equal(f.rpcs[0][0],'fn_processar_evento_pagamento_asaas');
 assert.equal(f.rpcs[0][1].p_novo_status,'PAGO');assert.equal(f.notifications.length,1);
 assert.equal(f.requests.length,0);assert.ok(f.updates.some(x=>x.phase==='DONE'));
});
test('authorized and risk-analysis cards are never expired as unpaid pending checkouts',async()=>{
 for(const status of ['AUTHORIZED','AWAITING_RISK_ANALYSIS']){
 const f=reconcileFixture({billing:'CREDIT_CARD',status,age:10*86400000});
 await f.api.reconcileCheckout(10,f.payment);assert.equal(f.requests.length,0);assert.equal(f.rpcs.length,0);
 }
});
test('ambiguous charge submission reconciles by reference and never blindly retries or frees stock',async()=>{
 for(const list of [{data:[]},{data:[{id:'a'},{id:'b'}]}]){
 const f=reconcileFixture({phase:'SENDING',age:3600000,list});
 if(list.data.length>1)await assert.rejects(f.api.reconcileCheckout(10),/conflitantes/);else await f.api.reconcileCheckout(10);
 assert.ok(f.updates.some(x=>x.phase==='REVIEW'));
 assert.equal(f.requests.filter(([,init])=>init?.method==='POST'||init?.method==='DELETE').length,0);
 }
});
test('a late paid webhook cannot release an already-cancelled reservation',async()=>{
 const f=reconcileFixture({phase:'CANCELLED',status:'RECEIVED'});
 await assert.rejects(f.api.reconcileCheckout(10,f.payment),/revisão manual obrigatória/);
 assert.ok(f.updates.some(update=>update.phase==='REVIEW'));
 assert.equal(f.requests.length,0);
});
test('expired Pix only releases inventory after a confirmed provider deletion',async()=>{
 for(const deleteSucceeds of [false,true]){
  const f=reconcileFixture({age:3600000,deleteSucceeds});
  if(deleteSucceeds){await f.api.reconcileCheckout(10,f.payment);assert.ok(f.rpcs.some(([name])=>name==='fn_checkout_cancel_bound'));assert.ok(f.requests.some(([path])=>path==='release'));}
  else {await assert.rejects(f.api.reconcileCheckout(10,f.payment),/unexpected provider mutation/);assert.equal(f.requests.some(([path])=>path==='release'),false);}
 }
});
test('boleto releases inventory only after acknowledged bank cancellation, settlement margin and provider deletion',async()=>{
 const f=reconcileFixture({billing:'BOLETO',status:'OVERDUE',age:10*86400000,cancelledAt:'2026-10-14T12:00:00Z',deleteSucceeds:true});
 await f.api.reconcileCheckout(10,f.payment);
 assert.ok(f.requests.some(([,init])=>init?.method==='DELETE'));
 assert.ok(f.rpcs.some(([name])=>name==='fn_checkout_cancel_bound'));
 assert.ok(f.requests.some(([path])=>path==='release'));
});
test('checkout status is scoped to its customer and works before an order exists',async()=>{
 for(const owner of [7,8]){
  let reconciled=0;
  const admin={from(table){const filters={};return {select(){return this;},eq(key,value){filters[key]=value;return this;},async maybeSingle(){return {data:table==='checkout_attempt'&&filters.cliente_id===7?{phase:'BOUND',payment_id:'pay_pending',created_at:'2026-10-22T12:00:00Z',checkout_payload:{total:125,method:'PIX'},payment_data:{status:'PENDING'}}:null,error:null};},async single(){return this.maybeSingle();}};}};
  const {pendingCheckoutStatus}=load('storefront-template/lib/checkout-pending-status.ts',{'@/lib/supabase/admin':{supabaseAdmin:admin},'@/lib/checkout-reconcile':{reconcileCheckout:async()=>{reconciled++;}}});
  const result=await pendingCheckoutStatus(10,owner);
  if(owner===7){assert.equal(result.isPaid,false);assert.equal(result.isPending,true);assert.equal(result.total,125);assert.equal(reconciled,1);}
  else {assert.equal(result,null);assert.equal(reconciled,0);}
 }
});
test('refund of an uncompleted checkout does not create a cancelled customer order',async()=>{
 const f=reconcileFixture({status:'REFUNDED'});
 await f.api.reconcileCheckout(10,f.payment);
 assert.equal(f.rpcs.length,0,'financial order event must not run without an order');
 assert.ok(f.updates.some(update=>update.phase==='DONE'));
});
