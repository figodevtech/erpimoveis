const assert=require('node:assert/strict');const Module=require('node:module');const path=require('node:path');require('tsx/cjs');
let allowed=true,requested=false,received=false,remoteStatus=200,operator='operator-id',sent=[],writes=[];
process.env.STOREFRONT_API_URL='https://store.test';process.env.STOREFRONT_ORDER_SYNC_SECRET='test';
const original=Module._load;
Module._load=function(name,...args){
 if(name==='@/lib/supabaseAdmin')return{supabaseAdmin:{from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{venda_id:10,return_requested_at:requested?'2026-10-09':null,return_received_at:received?'2026-10-09':null},error:null}),update(data){writes.push(data);return q},then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject)}};return q}}};
 if(name==='@/app/api/_authz/perms')return{requireVendasEdit:async()=>{if(!allowed)throw Object.assign(Error('Forbidden'),{status:403})}};
 if(name==='@/lib/empresa-context')return{requireEmpresaId:async()=>1,errorStatus:e=>e.status||500};
 if(name==='@/lib/auth')return{auth:async()=>({user:{id:operator}})};
 if(name==='@/lib/integrations/site-refund-status')return{refreshSiteRefundStatus:async()=>{}};
 if(name==='@/lib/read-json-response')return{readJsonResponse:r=>r.json()};
 if(name==='@/lib/integrations/storefront-http')return{storefrontFetch:async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({error:'Store unavailable'},{status:remoteStatus})}};
 return original.call(this,name,...args);
};
const {PUT}=require(path.resolve('src/app/api/integracoes/site/orders/[id]/route.ts'));
const call=body=>PUT(new Request('http://localhost/api',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id:'100'})});
(async()=>{
 allowed=false;assert.equal((await call({})).status,403);assert.equal(sent.length,0);allowed=true;
 assert.equal((await call({action:'RECEIVE_RETURN',reason:'Conferido',allItemsApproved:true})).status,409);
 assert.equal((await call({action:'REQUEST_RETURN',reason:'Cliente solicitou',operator:'forged'})).status,200);assert.equal(sent.at(-1).operator,operator,'operator must come from session');assert.ok(writes.at(-1).return_requested_at);
 requested=true;assert.equal((await call({action:'RECEIVE_RETURN',reason:'Conferido'})).status,409);
 assert.equal((await call({action:'RECEIVE_RETURN',reason:'Todos os itens recebidos',allItemsApproved:true})).status,200);assert.ok(writes.at(-1).return_received_at);assert.equal(writes.at(-1).return_received_by,operator);
 remoteStatus=503;const before=writes.length;assert.equal((await call({action:'RECEIVE_RETURN',reason:'Conferido',allItemsApproved:true})).status,503);assert.equal(writes.length,before,'failed store must not mark ERP receipt');
 console.log('PASS: ERP return permissions, request before receipt, explicit all-items approval, session-bound operator and store failure prevents local receipt.');
})().catch(error=>{console.error(error);process.exitCode=1});
