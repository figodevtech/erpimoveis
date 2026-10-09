const assert=require('node:assert/strict');const Module=require('node:module');require('tsx/cjs');
process.env.STOREFRONT_API_URL='https://store.test';process.env.STOREFRONT_ORDER_SYNC_SECRET='test';
let patch;let status={gatewayStatus:'REFUND_REQUESTED',refundStatus:'REFUND_REQUESTED'};
const form='https://sandbox.asaas.com/000/solicitar-estorno/test';
const original=Module._load;
Module._load=function(name,...args){
 if(name==='@/lib/supabaseAdmin')return{supabaseAdmin:{from(){const q={select(){return q},eq(){return q},single:async()=>({data:{venda_id:null,refund_request_url:form},error:null}),update(data){patch=data;return q},then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject)}};return q}}};
 if(name==='@/lib/integrations/storefront-http')return{storefrontFetch:async()=>Response.json(status)};
 return original.call(this,name,...args);
};
const {refreshSiteRefundStatus}=require('../../src/lib/integrations/site-refund-status.ts');
(async()=>{
 const result=await refreshSiteRefundStatus(1,30);assert.equal(patch.refund_request_url,form);assert.equal(patch.refund_status,'AWAITING_CUSTOMER');assert.equal(result.requestUrl,form);
 status={gatewayStatus:'REFUNDED',refundStatus:'REFUNDED'};await refreshSiteRefundStatus(1,30);assert.equal(patch.refund_status,'REFUNDED');
 status={gatewayStatus:'RECEIVED',refundStatus:'DENIED'};await refreshSiteRefundStatus(1,30);assert.equal(patch.refund_status,'DENIED');
 console.log('PASS: omitted boleto form is retained; confirmed refund and denial are not replaced by awaiting-customer status.');
})().catch(error=>{console.error(error);process.exitCode=1});
