const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
require('tsx/cjs');
process.env.ERP_ORDER_SYNC_SECRET = 'test-secret';
let delivery = 'SEPARACAO';
let physicalReturn = null, bankUrl = null, bankCalls = 0;
let billingType = 'PIX', previous = null, reopen = true, paymentRefunds = [];
let status = 'RECEIVED', claimed = false, refunds = 0, processed = 0;
const db = {
 from(table) {
  const q = {select(){return q},eq(){return q},async maybeSingle(){return {data:table==='site_order_return'?physicalReturn:table==='site_order_refund_request'?(previous||{request_url:bankUrl}):{id:1,gateway_payment_id:'pay_test',payment_provider:'ASAAS',status:'PAGO',status_entrega:delivery}}},
   update(value){bankUrl=value.request_url;return {eq:async()=>({error:null})}},
   async insert(){ if(claimed) return {error:{code:'23505'}}; claimed=true; return {error:null}},
   delete(){return {eq:async()=>{claimed=false}}}};
  return q;
 }, async rpc(name){if(name==='fn_reabrir_estorno_recusado_site')return {data:reopen,error:null};processed++; return {error:null}}
};
class AsaasApiError extends Error {}
const original = Module._load;
Module._load = function(name, ...args) {
 if(name==='@/lib/supabase/admin') return {supabaseAdmin:db};
 if(name==='@/lib/asaas') return {AsaasApiError,
  getAsaasPayment:async()=>({id:'pay_test',externalReference:'1',billingType,status,refunds:paymentRefunds}),
  refundAsaasBankSlip:async()=>{bankCalls++;return {requestUrl:'https://sandbox.asaas.com/solicitar-estorno/test'}},
  refundAsaasPayment:async()=>{refunds++;return {id:'pay_test',status:'REFUND_REQUESTED'}}};
 return original.call(this,name,...args);
};
const {POST} = require(path.resolve('site_demirdiesel/app/api/integrations/erp/orders/[id]/route.ts'));
function request(token='test-secret'){return new Request('http://localhost/orders/1',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({reason:'Teste de cancelamento'})})}
(async()=>{
 assert.equal((await POST(request('wrong'),{params:Promise.resolve({id:'1'})})).status,401);
 const first=await (await POST(request(),{params:Promise.resolve({id:'1'})})).json();
 assert.equal(first.pending,true); assert.equal(refunds,1); assert.equal(processed,0);
 await POST(request(),{params:Promise.resolve({id:'1'})});
 assert.equal(refunds,1,'do not issue a second refund while result is uncertain');
 status='REFUNDED';
 const done=await (await POST(request(),{params:Promise.resolve({id:'1'})})).json();
 assert.equal(done.pending,false);assert.equal(processed,1);assert.equal(refunds,1);
 delivery='ENVIADO';
 assert.equal((await POST(request(),{params:Promise.resolve({id:'1'})})).status,409);
 assert.equal(refunds,1);
 assert.equal(processed,1);
 delivery='SEPARACAO'; status='CONFIRMED'; billingType='CREDIT_CARD'; claimed=false;
 assert.equal((await (await POST(request(),{params:Promise.resolve({id:'1'})})).json()).pending,true);
 assert.equal(refunds,2);assert.equal(processed,1,'credit card request cannot restore stock before confirmation');
 status='REFUNDED';
 assert.equal((await (await POST(request(),{params:Promise.resolve({id:'1'})})).json()).pending,false);
 assert.equal(processed,2);
 status='RECEIVED';billingType='BOLETO';claimed=false;
 const boleto=await (await POST(request(),{params:Promise.resolve({id:'1'})})).json();
 assert.equal(boleto.pending,true);assert.equal(boleto.requestUrl,'https://sandbox.asaas.com/solicitar-estorno/test');assert.equal(bankCalls,1);
 await POST(request(),{params:Promise.resolve({id:'1'})});assert.equal(bankCalls,1);
 assert.equal(refunds,2,'boleto must use dedicated endpoint');assert.equal(processed,2);bankUrl=null;
 billingType='PIX';claimed=true;previous={denied_at:'2026-10-08T15:00:00Z',denial_reason:'Denied'};
 paymentRefunds=[{status:'PENDING'}];
 assert.equal((await POST(request(),{params:Promise.resolve({id:'1'})})).status,409);
 assert.equal(refunds,2,'existing provider refund blocks retry');
 paymentRefunds=[];reopen=false;
 await POST(request(),{params:Promise.resolve({id:'1'})});assert.equal(refunds,2,'losing concurrent retry claim cannot issue refund');
 reopen=true;
 await POST(request(),{params:Promise.resolve({id:'1'})});assert.equal(refunds,3,'accepted retry issues one new refund');
 assert.equal(processed,2,'retry cannot restore stock before provider confirmation');
 delivery='ENVIADO';physicalReturn={received_at:'2026-10-09T15:00:00Z'};status='REFUNDED';
 assert.equal((await POST(request(),{params:Promise.resolve({id:'1'})})).status,200);assert.equal(processed,3);
 status='PENDING';billingType='BOLETO';delivery='SEPARACAO';
 assert.equal((await POST(request(),{params:Promise.resolve({id:'1'})})).status,409);assert.equal(bankCalls,1);
 console.log('PASS: authorization, Pix/card refunds, duplicate prevention, shipped/inspected return guards, boleto URL/deduplication/unpaid rejection and concurrent retry claim.');
})().catch(e=>{console.error(e);process.exitCode=1});
