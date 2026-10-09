// Explicitly authorized Sandbox purchase. Run one stage at a time; keep audit state ignored.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import pg from 'pg';
import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';
import {loadDatabaseConfigs,connectDatabase} from '../db/lib.ts';
const env={...nextEnv.loadEnvConfig(path.resolve('site_demirdiesel'),true,{info(){},error(){}},true).combinedEnv};
const api=(env.ASAAS_API_URL||((env.ASAAS_ENVIRONMENT||'sandbox')==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3')).replace(/\/$/,'');
if(new URL(api).hostname!=='api-sandbox.asaas.com')throw Error('Sandbox not confirmed; no mutations allowed');
const scenario=process.argv[3]||'original';
if(!['original','saved-card','pix','boleto','shipping','card-regression','physical-return'].includes(scenario))throw Error('Unknown scenario');
const originalFile='node_modules/.cache/order-cleanup/sandbox-purchase-20261009.json';
const file=scenario==='original'?originalFile:originalFile.replace('.json',`-${scenario}.json`);
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
const save=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(state,null,2));};
const supabase=createClient(env.NEXT_PUBLIC_STORE_SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL,env.STORE_SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function http(url,method='GET',body,headers={}){
 const r=await fetch(url,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(65000)});
 const d=await r.json().catch(()=>({error:'Non-JSON response'}));if(!r.ok)throw Error(JSON.stringify({http:r.status,error:d.message||d.error||d.errors}));return d;
}
const asaas=(endpoint,method='GET',body)=>http(api+endpoint,method,body,{access_token:env.ASAAS_API_KEY.trim()});
async function testSession(){
 const {data,error}=await supabase.auth.admin.generateLink({type:'magiclink',email:state.email});if(error)throw error;
 const session=await supabase.auth.verifyOtp({token_hash:data.properties.hashed_token,type:'magiclink'});if(session.error)throw session.error;
 return {Authorization:'Bearer '+session.data.session.access_token};
}
const dbUrl=fs.readFileSync('site_demirdiesel/.env.migrations','utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g,'');
const store=new pg.Client({connectionString:dbUrl,ssl:{rejectUnauthorized:false}});await store.connect();
nextEnv.resetEnv();const erp=(await connectDatabase(loadDatabaseConfigs().find(x=>x.key==='demir'))).client;
const stage=process.argv[2];
try{
 if(stage==='new-scenario'){
  if(state.userId)throw Error('Scenario already prepared');
  const original=JSON.parse(fs.readFileSync(originalFile,'utf8'));
  if(!original.verifiedAt)throw Error('Original test not reconciled');
  const stocks={store:Number((await store.query('select estoque from produto where id=853')).rows[0].estoque),erp:Number((await erp.query('select estoque from produto where id=853')).rows[0].estoque)};
  state={userId:original.userId,email:original.email,cpf:original.cpf,customerId:original.customerId,addressId:original.addressId,productId:853,quantity:1,total:20,baseline:stocks,scenario,billingType:scenario==='pix'?'PIX':scenario==='boleto'?'BOLETO':'CREDIT_CARD',startedAt:new Date().toISOString()};save();
  if(['shipping','card-regression','physical-return'].includes(scenario)){const saved=JSON.parse(fs.readFileSync(originalFile.replace('.json','-saved-card.json'),'utf8'));if(!saved.verifiedAt)throw Error('Saved card test not reconciled');state.savedCardId=saved.savedCardId;save();}
  console.log(JSON.stringify({stage,scenario,baseline:stocks}));
 }else if(stage==='return-flow'){
  if(scenario!=='physical-return'||!state.orderId)throw Error('Identified return test required');
  const url=`http://localhost:3002/api/integrations/erp/orders/${state.orderId}`;
  const headers={Authorization:'Bearer '+env.ERP_ORDER_SYNC_SECRET};
  await http(url,'PATCH',{deliveryStatus:'ENVIADO',trackingCode:'TESTE-DEVOLUCAO-SEM-ENVIO',carrier:'Transportadora ficticia'},headers);
  await http(url,'PUT',{action:'REQUEST_RETURN',reason:'Teste Sandbox: devolucao integral simulada',operator:state.userId},headers);
  let blocked=false;
  try{await http(url,'POST',{reason:'Teste do bloqueio antes da conferencia'},headers);}catch(error){blocked=String(error.message).includes('409');}
  if(!blocked)throw Error('Refund before physical receipt was not blocked');
  await http(url,'PUT',{action:'RECEIVE_RETURN',reason:'Teste: todos os itens conferidos; nenhuma mercadoria saiu fisicamente',operator:state.userId,allItemsApproved:true},headers);
  // Harness only: persist the same verified receipt in ERP; this does not test its authenticated UI route.
  await erp.query("update site_order_link set return_requested_at=now(),return_received_at=now(),return_received_by=$2,return_reason='Teste Sandbox devolucao simulada',return_inspection_note='Todos os itens de teste conferidos' where site_order_id=$1 and venda_id is not null",[state.orderId,state.userId]);
  state.returnReceivedAt=new Date().toISOString();save();
  console.log(JSON.stringify({stage,orderId:state.orderId,unreceivedRefundBlocked:blocked,receiptRecorded:true,simulatedPhysicalMovement:true}));
 }else if(stage==='finalize-return-erp'){
  if(scenario!=='physical-return'||!state.returnReceivedAt)throw Error('Only inspected return test');
  const payment=await asaas('/payments/'+state.paymentId);
  const receipt=(await store.query('select received_at,restocked_at from site_order_return where order_id=$1',[state.orderId])).rows[0];
  const link=(await erp.query('select venda_id,return_received_at,refund_status from site_order_link where site_order_id=$1',[state.orderId])).rows[0];
  if(payment.status!=='REFUNDED'||!payment.refunds?.some(x=>x.status==='DONE')||!receipt?.received_at||!receipt.restocked_at||!link?.return_received_at||link.refund_status!=='REFUNDED')throw Error('Return/refund not verified');
  await erp.query('select cancelar_venda($1,$2,null)',[link.venda_id,'Teste Sandbox: devolucao integral conferida e reembolso DONE']);
  await erp.query("update site_order_link set site_status='CANCELADO' where site_order_id=$1",[state.orderId]);
  console.log(JSON.stringify({stage,orderId:state.orderId,officialCancellation:true}));
 }else if(stage==='save-card'){
  if(scenario!=='saved-card'||state.savedCardId)throw Error('Invalid card save stage');
  const headers=await testSession();
  const result=await http('http://localhost:3002/api/account/cards','POST',{holderName:'TESTE SANDBOX',number:'4444444444444444',expiryMonth:'12',expiryYear:'2030',ccv:'123'},headers);
  state.savedCardId=result.card.id;save();
  const listed=await http('http://localhost:3002/api/account/cards','GET',null,headers);
  if(!listed.cards.some(x=>x.id===state.savedCardId))throw Error('Saved card missing in list');
  console.log(JSON.stringify({stage,listed:true,lastFour:result.card.lastFour}));
 }else if(stage==='fulfillment-check'){
  if(!['saved-card','shipping'].includes(scenario))throw Error('Use exclusively an identified disposable logistics test order');
  const snapshot=(await store.query('select status_entrega,enviado_em,entregue_em,codigo_rastreio,transportadora,url_rastreio from venda where id=$1 and clienteid=$2 and status=\'PAGO\'',[state.orderId,state.customerId])).rows[0];
  if(!snapshot)throw Error('Own paid test order not found');
  state.fulfillmentSnapshot=snapshot;save();
  const url=`http://localhost:3002/api/integrations/erp/orders/${state.orderId}`;
  const headers={Authorization:'Bearer '+env.ERP_ORDER_SYNC_SECRET};
  try {
   await http(url,'PATCH',{deliveryStatus:'ENVIADO',...(scenario==='shipping'?{trackingCode:'TESTE-SANDBOX-SEM-ENVIO',carrier:'Transportadora ficticia de teste',trackingUrl:'https://example.com/rastreio-teste'}:{})},headers);
   const shipping=(await store.query('select status_entrega,codigo_rastreio,transportadora,url_rastreio from venda where id=$1',[state.orderId])).rows[0];
   if(shipping.status_entrega!=='ENVIADO'||(scenario==='shipping'&&shipping.codigo_rastreio!=='TESTE-SANDBOX-SEM-ENVIO'))throw Error('Shipping details not persisted');
   let blocked=false;try{await http(url,'POST',{reason:'Teste de bloqueio apos envio simulado'},headers);}catch(e){blocked=String(e.message).includes('409');}
   if(!blocked)throw Error('Refund after delivery was not blocked');
   await http(url,'PATCH',{deliveryStatus:'ENTREGUE'},headers);
   let blockedDelivered=false;try{await http(url,'POST',{reason:'Teste de bloqueio apos entrega simulada'},headers);}catch(e){blockedDelivered=String(e.message).includes('409');}
   if(!blockedDelivered)throw Error('Refund after delivered was not blocked');
   const stock=Number((await store.query('select estoque from produto where id=853')).rows[0].estoque);
   if(stock!==state.baseline.store-1)throw Error('Delivery incorrectly changed stock');
   state.fulfillmentTest={ready:true,completed:true,refundBlocked:true,noSecondStockDebit:true};save();
   console.log(JSON.stringify({stage,...state.fulfillmentTest}));
  }finally {
   // Only undo simulated logistics on this identified test order: no goods were moved.
   await store.query('update venda set status_entrega=$1,enviado_em=$2,entregue_em=$3,codigo_rastreio=$4,transportadora=$5,url_rastreio=$6 where id=$7 and clienteid=$8',[snapshot.status_entrega,snapshot.enviado_em,snapshot.entregue_em,snapshot.codigo_rastreio,snapshot.transportadora,snapshot.url_rastreio,state.orderId,state.customerId]);
  }
 }else if(stage==='pix-code'){
  const qr=await asaas('/payments/'+state.paymentId+'/pixQrCode');
  state.pixPayload=qr.payload;save();console.log(JSON.stringify({stage,orderId:state.orderId,checkoutUrl:state.checkoutUrl,payload:qr.payload}));
 }else if(stage==='prepare'){
  if(state.userId)throw Error('Test already prepared');
  const product=(await store.query('select id,estoque,precovenda,visible,is_deleted from produto where id=853')).rows[0];
  const erpProduct=(await erp.query('select id,estoque from produto where id=853')).rows[0];
  if(!product.visible||product.is_deleted||Number(product.estoque)<2||Number(product.precovenda)!==20)throw Error('Product not suitable for controlled test');
  state={productId:853,quantity:1,total:20,baseline:{store:Number(product.estoque),erp:Number(erpProduct.estoque)},startedAt:new Date().toISOString()};save();
  const email=`teste-integracao-${Date.now()}@example.com`;
  const {data,error}=await supabase.auth.admin.createUser({email,password:crypto.randomBytes(32).toString('hex'),email_confirm:true,user_metadata:{name:'Teste Sandbox Integracao'}});
  if(error)throw error;state.userId=data.user.id;state.email=email;state.cpf='52998224725';save();
  const customer=(await store.query("insert into cliente(user_id,tipopessoa,cpfcnpj,nomerazaosocial,email,telefone) values($1,'FISICA',$2,'Teste Sandbox Integracao',$3,'11999999999') returning id",[state.userId,state.cpf,email])).rows[0];
  state.customerId=customer.id;save();
  state.addressId=(await store.query("insert into cliente_endereco(cliente_id,cep,logradouro,numero,bairro,cidade,estado,principal) values($1,'58065198','Endereco ficticio de teste','1','Teste','Joao Pessoa','PB',true) returning id",[customer.id])).rows[0].id;save();
  console.log(JSON.stringify({stage,baseline:state.baseline,productId:853,total:20}));
 }else if(stage==='repair-test-contact'){
  const orders=(await store.query('select id,status,gateway_payment_id,estoque_baixado from venda where clienteid=$1',[state.customerId])).rows;
  if(orders.some(x=>x.gateway_payment_id||x.estoque_baixado))throw Error('Existing payment or stock movement requires reconciliation');
  await store.query("update venda set status='CANCELADO',observacao='Teste Sandbox: checkout rejeitado antes de criar cobranca',updatedat=now() where clienteid=$1 and gateway_payment_id is null and estoque_baixado=false",[state.customerId]);
  await store.query("update cliente set telefone='11987654321' where id=$1 and user_id=$2",[state.customerId,state.userId]);
  console.log(JSON.stringify({stage,failedOrders:orders.map(x=>x.id),stockAffected:false}));
 }else if(stage==='checkout'){
  if(state.orderId||!state.addressId)throw Error('Checkout already created or setup incomplete');
  const headers=await testSession();
  const result=await http('http://localhost:3002/api/checkout','POST',{addressId:state.addressId,deliveryMethod:scenario==='saved-card'?'pickup':'delivery',billingType:state.billingType||'CREDIT_CARD',...(state.savedCardId?{savedCardId:state.savedCardId}:{}),items:[{productId:853,quantity:1}]},headers);
  state.orderId=result.orderId;state.checkoutUrl=result.url;save();
  const order=(await store.query('select gateway_payment_id,commission_percent,commission_wallet_id,status from venda where id=$1',[state.orderId])).rows[0];
  state.paymentId=order.gateway_payment_id;save();
  console.log(JSON.stringify({stage,orderId:state.orderId,paymentId:state.paymentId,status:order.status,commissionPercent:order.commission_percent,walletConfigured:!!order.commission_wallet_id,checkoutUrl:state.checkoutUrl}));
 }else if(stage==='pay'){
  const payment=await asaas('/payments/'+state.paymentId);
  if(payment.status!=='PENDING'||payment.value!==20||String(payment.externalReference)!==String(state.orderId))throw Error('Payment is not the pending test charge');
  const result=await asaas('/payments/'+state.paymentId+'/payWithCreditCard','POST',{creditCard:{holderName:'TESTE SANDBOX',number:'4444444444444444',expiryMonth:'12',expiryYear:'2030',ccv:'123'},creditCardHolderInfo:{name:'Teste Sandbox Integracao',email:state.email,cpfCnpj:state.cpf,postalCode:'58065198',addressNumber:'1',phone:'11987654321'},remoteIp:'127.0.0.1'});
  state.paidAt=new Date().toISOString();save();console.log(JSON.stringify({stage,status:result.status}));
 }else if(stage==='close-unpaid-boleto'){
  if(scenario!=='boleto')throw Error('Only unpaid boleto test can be closed here');
  const payment=await asaas('/payments/'+state.paymentId);
  const order=(await store.query('select status,estoque_baixado from venda where id=$1 and clienteid=$2',[state.orderId,state.customerId])).rows[0];
  const link=(await erp.query('select venda_id from site_order_link where site_order_id=$1',[state.orderId])).rows[0];
  if(payment.status!=='PENDING'||order.estoque_baixado||link?.venda_id)throw Error('Paid order needs refund; cannot close as unpaid');
  let blocked=false;
  try{await http(`http://localhost:3002/api/integrations/erp/orders/${state.orderId}`,'POST',{reason:'Teste do bloqueio de estorno de boleto'},{Authorization:'Bearer '+env.ERP_ORDER_SYNC_SECRET});}
  catch(e){blocked=String(e.message).includes('409');}
  if(!blocked)throw Error('Unsupported boleto refund not blocked');
  const removed=await asaas('/payments/'+state.paymentId,'DELETE');
  if(!removed.deleted)throw Error('Boleto cancellation not confirmed');
  await store.query("update venda set status='CANCELADO',observacao='Teste Sandbox: boleto emitido e cancelado sem pagamento; nenhum estorno realizado',updatedat=now() where id=$1 and clienteid=$2 and estoque_baixado=false",[state.orderId,state.customerId]);
  state.closedUnpaidAt=new Date().toISOString();save();
  console.log(JSON.stringify({stage,orderId:state.orderId,deletedCharge:true,unsupportedRefundBlocked:true,stockAffected:false}));
 }else if(stage==='status'){
  const payment=state.paymentId?await asaas('/payments/'+state.paymentId):null;
  const order=state.orderId?(await store.query('select status,estoque_baixado,gateway_status,commission_percent from venda where id=$1',[state.orderId])).rows[0]:null;
  const link=state.orderId?(await erp.query('select venda_id,site_status,refund_status from site_order_link where site_order_id=$1',[state.orderId])).rows[0]:null;
  const stocks={store:Number((await store.query('select estoque from produto where id=853')).rows[0].estoque),erp:Number((await erp.query('select estoque from produto where id=853')).rows[0].estoque)};
  console.log(JSON.stringify({stage,orderId:state.orderId,paymentStatus:payment?.status,refunds:payment?.refunds?.map(x=>({status:x.status,value:x.value})),split:payment?.split?.map(x=>({status:x.status,percentualValue:x.percentualValue,totalValue:x.totalValue})),order,link,baseline:state.baseline,stocks}));
 }else if(stage==='notification-audit'){
  const rows=(await erp.query("select source_event_id,count(*)::int as total,count(*) filter(where telegram_sent_at is not null)::int as telegram_sent,count(*) filter(where telegram_attempts>0)::int as telegram_attempted,count(*) filter(where telegram_last_error is not null)::int as telegram_errors from system_notification where source='SITE_ORDER' and source_event_id=any($1) group by source_event_id order by source_event_id",[['SITE_ORDER:1:23','SITE_ORDER:1:24','SITE_ORDER:1:25']])).rows;
  console.log(JSON.stringify({stage,rows}));
 }else if(stage==='refund-audit'){
  const approvals=(await store.query('select operation_id,amount,approved_at from site_order_refund_authorization where order_id=$1',[state.orderId])).rows;
  const request=(await store.query('select denied_at,denial_reason,created_at from site_order_refund_request where order_id=$1',[state.orderId])).rows[0];
  const operations=[];
  for(const approval of approvals){const tx=await asaas('/pix/transactions/'+approval.operation_id);operations.push({status:tx.status,refusalReason:tx.refusalReason});}
  console.log(JSON.stringify({stage,approvals,request,operations}));
 }else if(stage==='verify-final'){
  const payment=await asaas('/payments/'+state.paymentId);
  const order=(await store.query('select status,estoque_baixado from venda where id=$1',[state.orderId])).rows[0];
  const sale=(await erp.query('select v.id,v.status from site_order_link l join venda v on v.id=l.venda_id where l.site_order_id=$1',[state.orderId])).rows[0];
  const stocks={store:Number((await store.query('select estoque from produto where id=853')).rows[0].estoque),erp:Number((await erp.query('select estoque from produto where id=853')).rows[0].estoque)};
  if(payment.status!=='REFUNDED'||!payment.refunds?.some(x=>x.status==='DONE')||order.status!=='CANCELADO'||order.estoque_baixado||!['CANCELADA','CANCELADO'].includes(sale?.status)||stocks.store!==state.baseline.store||stocks.erp!==state.baseline.erp)throw Error('Final reconciliation failed');
  const events=(await store.query('select event_type,gateway_status,resulting_order_status from payment_webhook_event where venda_id=$1 order by id',[state.orderId])).rows;
  const notifications=(await erp.query("select count(*)::int as total from system_notification where source='SITE_ORDER' and source_event_id=$1",[`SITE_ORDER:1:${state.orderId}`])).rows[0];
  state.verifiedAt=new Date().toISOString();state.finalStocks=stocks;state.erpSaleId=sale.id;save();
  console.log(JSON.stringify({stage,orderId:state.orderId,sale,stocks,events,notifications,pass:true}));
 }else if(stage==='refund'){
  const result=await http(`http://localhost:3002/api/integrations/erp/orders/${state.orderId}`,'POST',{reason:'Teste Sandbox autorizado: compra completa e restauracao de estoque'},{Authorization:'Bearer '+env.ERP_ORDER_SYNC_SECRET});
  state.refundRequestedAt=new Date().toISOString();save();console.log(JSON.stringify({stage,...result}));
 }else throw Error('Choose prepare, checkout, pay, status or refund');
}finally{await store.end();await erp.end();}
