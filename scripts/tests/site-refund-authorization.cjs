const assert=require('node:assert/strict');const Module=require('node:module');const fs=require('node:fs');const path=require('node:path');const {PGlite}=require('../../central.figosoftwares.com.br/node_modules/@electric-sql/pglite');require('tsx/cjs');
process.env.ASAAS_REFUND_AUTHORIZATION_TOKEN='a'.repeat(40);
const operationId='06391ba9-cbf9-4926-8988-374ac5d71cae';const originalId='8fff6b9c-4dfd-4487-a0fe-2fc1fbd08258';let amount=20,allowed=true,fail=false,calls=0;
const original=Module._load;Module._load=function(name,...args){if(name==='@/lib/asaas')return {asaasRequest:async url=>{if(fail)throw Error('network');return url.startsWith('/pix/')?{id:operationId,payment:'pay_test',type:'CREDIT_REFUND',status:'AWAITING_REQUEST',value:amount,dateCreated:'07/10/2026 20:48:06',originalTransaction:{id:originalId}}:{id:'pay_test',billingType:'PIX',status:'RECEIVED',value:20,externalReference:'21',pixTransaction:originalId}}};if(name==='@/lib/supabase/admin')return{ supabaseAdmin:{rpc:async()=>{calls++;return {data:allowed,error:null}}}};return original.call(this,name,...args)};
const {POST}=require(path.resolve('site_demirdiesel/app/api/webhooks/asaas/authorize-refund/route.ts'));
const payload={type:'PIX_REFUND',pixRefund:{id:operationId,payment:'pay_test',value:20,type:'CREDIT_REFUND',originalTransaction:{id:originalId}}};
function request(body=payload,token='a'.repeat(40)){return new Request('http://localhost/api',{method:'POST',headers:{'asaas-access-token':token,'Content-Type':'application/json'},body:JSON.stringify(body)})}
(async()=>{
assert.equal((await POST(request(payload,'wrong'))).status,401);assert.equal(calls,0);
assert.equal((await (await POST(request({type:'TRANSFER'}))).json()).status,'REFUSED');
assert.equal((await (await POST(request())).json()).status,'APPROVED');
amount=19;assert.equal((await (await POST(request())).json()).status,'REFUSED');assert.equal(calls,1);amount=20;allowed=false;assert.equal((await (await POST(request())).json()).status,'REFUSED');fail=true;assert.equal((await POST(request())).status,503);
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
create table venda(id bigint primary key,canal text,status text,payment_provider text,gateway_payment_id text,valortotal numeric,status_entrega text,enviado_em timestamptz,entregue_em timestamptz);
create table site_order_refund_request(order_id bigint primary key,payment_id text,created_at timestamptz,denied_at timestamptz);
insert into venda values(21,'ONLINE','PAGO','ASAAS','pay_test',20,'SEPARACAO',null,null);
insert into site_order_refund_request values(21,'pay_test','2026-10-07T23:48:04Z',null);`);
await db.exec(fs.readFileSync('site_demirdiesel/supabase/migrations/20261008120000_authorize_erp_pix_refund.sql','utf8'));
async function approve(id=operationId,value=20,date='2026-10-07T23:48:06Z'){return (await db.query('select fn_autorizar_estorno_pix_erp($1,21,$2,$3,$4) as approved',[id,'pay_test',value,date])).rows[0].approved}
assert.equal(await approve(operationId,19),false);assert.equal(await approve(operationId,20,'2026-10-06T22:45:30Z'),false);
assert.equal(await approve(),true);assert.equal(await approve(),true);assert.equal(await approve('another-operation'),false);
await db.exec("update venda set status_entrega='ENVIADO'");assert.equal(await approve(),false);
assert.equal((await db.query('select count(*)::int as n from site_order_refund_authorization')).rows[0].n,1);
await db.close();console.log('PASS: tokens, supported type, authoritative amount, request binding, stale operation, idempotency, duplicate authorization and shipped order protection');
})().catch(e=>{console.error(e);process.exitCode=1});
