const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
require('tsx/cjs');
process.env.ERP_ORDER_SYNC_SECRET = 'test-secret';
let delivery = 'SEPARACAO';
let status = 'RECEIVED', claimed = false, refunds = 0, processed = 0;
const db = {
 from(table) {
  const q = {select(){return q},eq(){return q},async maybeSingle(){return {data:{id:1,gateway_payment_id:'pay_test',payment_provider:'ASAAS',status:'PAGO',status_entrega:delivery}}},
   async insert(){ if(claimed) return {error:{code:'23505'}}; claimed=true; return {error:null}},
   delete(){return {eq:async()=>{claimed=false}}}};
  return q;
 }, async rpc(){processed++; return {error:null}}
};
class AsaasApiError extends Error {}
const original = Module._load;
Module._load = function(name, ...args) {
 if(name==='@/lib/supabase/admin') return {supabaseAdmin:db};
 if(name==='@/lib/asaas') return {AsaasApiError,
  getAsaasPayment:async()=>({id:'pay_test',externalReference:'1',billingType:'PIX',status}),
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
 console.log('PASS: authorization, pending refund preserves stock, duplicate refund prevention, confirmed refund processes cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1});
