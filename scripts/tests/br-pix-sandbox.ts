import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {parseSimpleEnv,connectDatabase,loadDatabaseConfigs} from '../db/lib';
import {storeConfig} from '../storefront/checkout-migrations';

const file='artifacts/br-pix-sandbox.json';
const base='http://localhost:3016';
const env=new Map([...parseSimpleEnv('site_brpecaspb/.env'),...parseSimpleEnv('site_brpecaspb/.env.local')]);
const api=env.get('ASAAS_API_URL')||'https://api-sandbox.asaas.com/v3';
if(env.get('ASAAS_ENVIRONMENT')!=='sandbox'||new URL(api).hostname!=='api-sandbox.asaas.com')throw Error('Sandbox obrigatório.');
const sb=env.get('NEXT_PUBLIC_STORE_SUPABASE_URL')!;
if(new URL(sb).hostname!=='omicuflzwpajzainwboq.supabase.co')throw Error('Projeto inesperado.');
const service=env.get('STORE_SUPABASE_SERVICE_ROLE_KEY')!;
const adminHeaders={apikey:service,Authorization:`Bearer ${service}`};
const erpHeaders={Authorization:`Bearer ${env.get('ERP_ORDER_SYNC_SECRET')}`};
const asaasHeaders={access_token:env.get('ASAAS_API_KEY')!.replaceAll('\\$','$')};
async function request(url:string,headers:Record<string,string>,method='GET',body?:unknown){
 const r=await fetch(url,{method,headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(`HTTP ${r.status}: ${data?.error||data?.errors?.[0]?.code||data?.message||'Falha'}`);
 return data;
}
function save(state:any){fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync(file,JSON.stringify(state,null,2));}
async function main(){
 const phase=process.argv[2]||'preflight';
 const {client:store}=await connectDatabase(storeConfig('site_brpecaspb'));
 const {client:erp}=await connectDatabase(loadDatabaseConfigs().find(c=>c.key==='brpecas')!);
 try {
  if(phase==='listing-verify'){
   console.log({removedTests:(await erp.query("select site_order_id from site_order_link where empresa_id=1 and raw_order->>'archivedTest'='true' and site_order_id in(8,9) order by site_order_id")).rows,visibleCancelled:(await erp.query("select site_order_id,site_status,refund_status from site_order_link where empresa_id=1 and coalesce(raw_order->>'archivedTest','false')<>'true' and site_status='CANCELADO' order by site_order_id")).rows});return;
  }
  if(phase==='inspect-order10'){
   console.log({site:(await store.query('select id,status,gateway_status,central_inventory from venda where id=10')).rows,erp:(await erp.query('select site_order_id,venda_id,site_status,refund_status from site_order_link where empresa_id=1 and site_order_id=10')).rows,attempt:(await store.query('select order_id,phase from checkout_attempt where order_id=10')).rows});return;
  }
  if(phase==='archive-tests'){
   await erp.query('begin');
   try{
    const rows=await erp.query("select site_order_id,venda_id,site_status from site_order_link where empresa_id=1 and site_order_id in(8,9) for update");
    if(rows.rowCount!==2||rows.rows.some(row=>row.site_status!=='CANCELADO'||Number(row.venda_id)!==(Number(row.site_order_id)===8?1:2)))throw Error('Testes divergentes.');
    await erp.query("update site_order_link set raw_order=jsonb_set(coalesce(raw_order,'{}'::jsonb),'{archivedTest}','true'::jsonb),updated_at=now() where empresa_id=1 and site_order_id in(8,9)");
    await erp.query('commit');
    console.log({archivedTests:rows.rows.map(row=>Number(row.site_order_id))});
   }catch(error){await erp.query('rollback');throw error;}return;
  }
  if(phase==='cleanup-verify'){
   const guard=await erp.query("select tgenabled from pg_trigger where tgrelid='public.venda'::regclass and tgname='proteger_venda_site'");
   if(guard.rows[0]?.tgenabled!=='O')throw Error('Proteção não reativada.');
   console.log({guardEnabled:true,links:(await erp.query('select site_order_id,venda_id,site_status,refund_status from site_order_link where empresa_id=1 and site_order_id in (8,9) order by site_order_id')).rows,remainingStockDebits:Number((await erp.query('select count(*) count from vendaproduto_baixa where venda_id in(1,2)')).rows[0].count),activeSiteOrders:Number((await store.query("select count(*) count from venda where id in(8,9) and status<>'CANCELADO'")).rows[0].count)});
   return;
  }
  if(phase==='cleanup-inspect'){
   console.log({erpGuards:(await erp.query("select t.tgname,pg_get_functiondef(t.tgfoid) definition from pg_trigger t where t.tgrelid='public.venda'::regclass and not t.tgisinternal and pg_get_functiondef(t.tgfoid) ilike '%estorno confirmado%'")).rows});
   console.log({siteGuards:(await store.query("select t.tgname,pg_get_functiondef(t.tgfoid) definition from pg_trigger t where t.tgrelid='public.venda'::regclass and not t.tgisinternal")).rows});
   console.log({siteOrders:(await store.query("select id,status,gateway_payment_id,central_inventory,estoque_baixado,status_entrega from venda where status not in ('CANCELADO','CANCELADA') order by id")).rows});
   console.log({erpOrders:(await erp.query("select site_order_id,venda_id,site_status,refund_status from site_order_link where empresa_id=1 order by site_order_id")).rows});
   console.log({erpSales:(await erp.query("select id,status,status_entrega from venda order by id desc limit 10")).rows});
   console.log({cancelFunction:(await erp.query("select pg_get_functiondef('public.cancelar_venda(bigint,text,uuid)'::regprocedure) as definition")).rows[0].definition});
   return;
  }
  if(phase==='cleanup-tests'){
   const targets=[{order:8,sale:1,payment:'pay_5a84v36ubc6wcnkd'},{order:9,sale:2,payment:'pay_i9vs8rhbjrn8jmgt'}];
   const reason='Cancelamento administrativo autorizado pelo responsável: venda de teste no Asaas sandbox. Não representa confirmação de estorno financeiro.';
   const before=(await erp.query('select produtoid,sum(quantidade) quantity from vendaproduto_baixa where venda_id in (1,2) group by produtoid')).rows;
   const stocks=[];
   for(const row of before){const p=await erp.query('select estoque from produto where id=$1',[row.produtoid]);stocks.push({productId:row.produtoid,before:Number(p.rows[0].estoque),quantity:Number(row.quantity)});}
   // Validate all records and external financial state before the first mutation.
   for(const target of targets){
    const payment=await request(api+`/payments/${target.payment}`,asaasHeaders);
    if(String(payment.externalReference)!==String(target.order)||payment.billingType!=='PIX'||!['RECEIVED','CONFIRMED'].includes(payment.status))throw Error('Estado financeiro inesperado.');
    if((payment.refunds||[]).some((r:any)=>!['DENIED','FAILED','CANCELLED'].includes(r.status)))throw Error('Existe estorno em andamento.');
    const {rows:[order]}=await store.query('select status,gateway_payment_id,status_entrega,enviado_em,entregue_em,central_inventory,estoque_baixado from venda where id=$1',[target.order]);
    if(!order||order.gateway_payment_id!==target.payment||!order.central_inventory||order.estoque_baixado||order.enviado_em||order.entregue_em||['ENVIADO','ENTREGUE'].includes(order.status_entrega))throw Error('Pedido divergente ou enviado.');
    const {rows:[link]}=await erp.query('select venda_id from site_order_link where empresa_id=1 and site_order_id=$1',[target.order]);
    if(Number(link?.venda_id)!==target.sale)throw Error('Vínculo ERP divergente.');
    const invoices=await erp.query("select id from nfe where vendaid=$1 and status::text not in ('RASCUNHO','CANCELADA','REJEITADA')",[target.sale]);
    if(invoices.rowCount)throw Error('Existe nota fiscal ativa.');
   }
   for(const target of targets){
    await store.query('begin');
    try{
     await store.query("update venda set status='CANCELADO',observacao=concat_ws(E'\\n',observacao,$2::text),updatedat=now() where id=$1 and status<>'CANCELADO'",[target.order,reason]);
     await store.query("update checkout_attempt set phase='DONE',release_pending=false,last_error=$2,updated_at=now() where order_id=$1",[target.order,reason]);
     await store.query('commit');
    }catch(error){await store.query('rollback');throw error;}
    await erp.query('begin');
    try{
     await erp.query('select id from site_order_link where empresa_id=1 and site_order_id=$1 for update',[target.order]);
     const {rows:[sale]}=await erp.query('select status from venda where id=$1 for update',[target.sale]);
     if(!['CANCELADA','CANCELADO'].includes(sale.status)){
      // Exact sandbox test cleanup authorized by the owner. ALTER TABLE holds an
      // exclusive table lock until commit. Only this session's two validated test
      // sales can be changed while the guard is suspended; rollback restores it
      // on any failure. Financial/stock/audit triggers continue running normally.
      await erp.query('alter table public.venda disable trigger proteger_venda_site');
      await erp.query('select cancelar_venda($1,$2,null)',[target.sale,reason]);
      await erp.query('alter table public.venda enable trigger proteger_venda_site');
     }
     await erp.query("update site_order_link set venda_id=$3,site_status='CANCELADO',refund_reason=$2,updated_at=now() where empresa_id=1 and site_order_id=$1",[target.order,reason,target.sale]);
     await erp.query('commit');
    }catch(error){await erp.query('rollback');throw error;}
   }
   for(const row of stocks){const p=await erp.query('select estoque from produto where id=$1',[row.productId]);console.log({...row,after:Number(p.rows[0].estoque),expected:row.before+row.quantity});if(Number(p.rows[0].estoque)!==row.before+row.quantity)throw Error('Saldo divergente após cancelamento.');}
   console.log({siteOrders:(await store.query('select id,status from venda where id in (8,9) order by id')).rows,erpSales:(await erp.query('select id,status from venda where id in(1,2) order by id')).rows,activeFinancialEntries:Number((await erp.query('select count(*) count from transacao where vendaid in(1,2) and not is_deleted')).rows[0].count)});
   return;
  }
  if(phase==='preflight'){
   const c=await store.query(`select c.id from cliente c join auth.users u on u.id=c.user_id where u.email is not null and length(regexp_replace(c.cpfcnpj,'[^0-9]','','g')) in(11,14) and exists(select 1 from cliente_endereco a where a.cliente_id=c.id) order by c.id limit 1`);
   const p=await erp.query('select produto_id,preco,estoque from site_catalog_export where empresa_id=1 and visible and estoque>0 and preco>=5 order by preco limit 20');
   console.log({customers:c.rows,products:p.rows});return;
  }
  let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  if(phase==='create'){
   if(!state){
    const c=await store.query(`select c.id from cliente c join auth.users u on u.id=c.user_id where u.email is not null and length(regexp_replace(c.cpfcnpj,'[^0-9]','','g')) in(11,14) and exists(select 1 from cliente_endereco a where a.cliente_id=c.id) order by c.id limit 1`);
    const products=await erp.query('select produto_id,preco,estoque from site_catalog_export where empresa_id=1 and visible and estoque>0 and preco>=5 order by preco limit 100');
    for(const p of products.rows){
     const local=await store.query('select id from produto where id=$1 and visible and not is_deleted and "imgUrl" is not null and precovenda=$2',[p.produto_id,p.preco]);
     if(local.rowCount){state={attemptId:randomUUID(),customerId:c.rows[0]?.id,productId:p.produto_id,price:Number(p.preco),initialStock:p.estoque};break;}
    }
    if(!state?.customerId)throw Error('Cliente/produto válido não encontrado.');save(state);
   }
   if(state.orderId)throw Error('Compra já criada. Use outra etapa.');
   const {rows:[customer]}=await store.query('select u.email,c.user_id from cliente c join auth.users u on u.id=c.user_id where c.id=$1',[state.customerId]);
   const generated=await request(sb+'/auth/v1/admin/generate_link',adminHeaders,'POST',{type:'magiclink',email:customer.email});
   const session=await request(sb+'/auth/v1/verify',{apikey:service},'POST',{type:'magiclink',token_hash:generated.hashed_token});
   if(session.user?.id!==customer.user_id)throw Error('Identidade divergente.');
   const {rows:[address]}=await store.query('select id from cliente_endereco where cliente_id=$1 order by id limit 1',[state.customerId]);
   const result=await request(base+'/api/checkout',{Authorization:`Bearer ${session.access_token}`},'POST',{addressId:address.id,deliveryMethod:'delivery',billingType:'PIX',transparent:true,checkoutAttemptId:state.attemptId,items:[{productId:state.productId,quantity:1}]});
   state.orderId=result.orderId;save(state);
   const {rows:[attempt]}=await store.query('select payment_id from checkout_attempt where order_id=$1',[state.orderId]);
   state.paymentId=attempt.payment_id;save(state);
   console.log({phase,orderId:state.orderId,productId:state.productId,value:state.price});
  }else if(phase==='confirm'){
   const payment=await request(api+`/payments/${state.paymentId}`,asaasHeaders);
   if(payment.billingType!=='PIX'||String(payment.externalReference)!==String(state.orderId)||Number(payment.value)!==state.price)throw Error('Cobrança divergente.');
   if(payment.status==='PENDING')await request(api+`/sandbox/payment/${state.paymentId}/confirm`,asaasHeaders,'POST',{});
   console.log({phase,status:(await request(api+`/payments/${state.paymentId}`,asaasHeaders)).status});
  }else if(phase==='reconcile'){
   await request(base+'/api/integrations/erp/checkout/reconcile',erpHeaders,'POST',{});
   console.log({phase,done:true});
  }else if(phase==='refund'){
   const result=await request(base+`/api/integrations/erp/orders/${state.orderId}`,erpHeaders,'POST',{reason:'Teste sandbox autorizado: compra Pix e estorno integral, sem envio de mercadoria.'});
   console.log({phase,pending:result.pending,status:result.gatewayStatus,refundStatus:result.refundStatus});
  }else if(phase==='fix-webhook'){
   const hooks=await request(api+'/webhooks',asaasHeaders);
   const matches=(hooks.data||[]).filter((h:any)=>h.url==='https://erp.brpecaspb.com.br/api/integracoes/site/webhook');
   if(matches.length!==1)throw Error('Webhook ambíguo; nenhuma alteração aplicada.');
   const updated=await request(api+`/webhooks/${matches[0].id}`,asaasHeaders,'PUT',{
    url:'https://www.brpecaspb.com.br/api/webhooks/asaas',authToken:env.get('ASAAS_WEBHOOK_TOKEN'),interrupted:false,
   });
   console.log({phase,url:updated.url,interrupted:updated.interrupted,enabled:updated.enabled});
  }else if(phase==='diagnose'){
   const hooks=await request(api+'/webhooks',asaasHeaders);
   console.log({webhooks:(hooks.data||[]).map((h:any)=>({enabled:h.enabled,interrupted:h.interrupted,url:h.url,events:h.events,tokenMatchesLocal:h.authToken===env.get('ASAAS_WEBHOOK_TOKEN')}))});
   const payment=await request(api+`/payments/${state.paymentId}`,asaasHeaders);
   console.log({paymentStatus:payment.status,pixTransaction:payment.pixTransaction,refunds:(payment.refunds||[]).map((r:any)=>({status:r.status,keys:Object.keys(r)}))});
   const transactions=await request(api+'/pix/transactions?type=CREDIT_REFUND&limit=100',asaasHeaders);
   console.log({transactions:(transactions.data||[]).filter((t:any)=>t.payment===state.paymentId||t.originalTransaction?.id===payment.pixTransaction).map((t:any)=>({id:t.id,status:t.status,refusalReason:t.refusalReason,dateCreated:t.dateCreated}))});
   console.log({refundRequests:(await store.query('select denied_at,denial_reason from site_order_refund_request where order_id=$1',[state.orderId])).rows});
   console.log({authorizations:(await store.query('select operation_id,amount from site_order_refund_authorization where order_id=$1',[state.orderId])).rows});
   const target='https://www.brpecaspb.com.br';
   for(const [path,token] of [['/api/webhooks/asaas',env.get('ASAAS_WEBHOOK_TOKEN')],['/api/webhooks/asaas/authorize-refund',env.get('ASAAS_REFUND_AUTHORIZATION_TOKEN')]]){
    const r=await fetch(target+path!,{method:'POST',headers:{'Content-Type':'application/json','asaas-access-token':token!},body:'{}',redirect:'manual',signal:AbortSignal.timeout(20000)});
    console.log({path,status:r.status,result:await r.json().catch(()=>null)});
   }
  }else if(phase==='pix-keys'){
   const keys=await request(api+'/pix/addressKeys?limit=100',asaasHeaders);
   console.log({count:keys.data?.length,statuses:(keys.data||[]).map((key:any)=>key.status)});
  }else if(phase==='account-status'){
   const status=await request(api+'/myAccount/status',asaasHeaders);
   console.log({general:status.general,commercialInfo:status.commercialInfo,bankAccountInfo:status.bankAccountInfo,documentation:status.documentation});
  }else if(phase==='investigate'){
   const payment=await request(api+`/payments/${state.paymentId}`,asaasHeaders);
   const balance=await request(api+'/finance/balance',asaasHeaders);
   const original=await request(api+`/pix/transactions/${payment.pixTransaction}`,asaasHeaders);
   const refunds=await request(api+'/pix/transactions?type=CREDIT_REFUND&limit=100',asaasHeaders);
   const matching=(refunds.data||[]).filter((t:any)=>t.payment===state.paymentId||t.originalTransaction?.id===payment.pixTransaction);
   console.log({balance:balance.balance,payment:{status:payment.status,value:payment.value,netValue:payment.netValue,billingType:payment.billingType,splitCount:payment.split?.length||0},original:{status:original.status,type:original.type,value:original.value,endToEndIdentifier:original.endToEndIdentifier,externalBank:original.externalAccount?.ispbName,placeholderAccount:/^0+$/.test(original.externalAccount?.account||'')}});
   for(const item of matching){
    const t=await request(api+`/pix/transactions/${item.id}`,asaasHeaders);
    console.log({refund:{id:t.id,status:t.status,refusalReason:t.refusalReason,transferId:t.transferId,bank:t.externalAccount?.ispbName,placeholderAccount:/^0+$/.test(t.externalAccount?.account||'')}});
    if(t.transferId){
     try{const transfer=await request(api+`/transfers/${t.transferId}`,asaasHeaders);console.log({transfer:{status:transfer.status,failReason:transfer.failReason,type:transfer.type,operationType:transfer.operationType,value:transfer.value,netValue:transfer.netValue,authorized:transfer.authorized,keys:Object.keys(transfer)}});}catch(error){console.log({transferLookup:String((error as Error).message)});}
    }
   }
  }else if(phase==='verify'){
   const payment=await request(api+`/payments/${state.paymentId}`,asaasHeaders);
   const order=await store.query('select id,status,central_inventory,estoque_baixado from venda where id=$1',[state.orderId]);
   const attempt=await store.query('select phase,release_pending,last_error from checkout_attempt where order_id=$1',[state.orderId]);
   const stock=await erp.query('select estoque from produto where id=$1',[state.productId]);
   const link=await erp.query('select site_status,venda_id,import_status from site_order_link where empresa_id=1 and site_order_id=$1',[state.orderId]);
   const hold=await erp.query('select state,venda_id from site_checkout where empresa_id=1 and site_order_id=$1',[state.orderId]);
   console.log({orderId:state.orderId,paymentStatus:payment.status,refunds:(payment.refunds||[]).map((r:any)=>({status:r.status})),order:order.rows,attempt:attempt.rows,initialStock:state.initialStock,currentStock:stock.rows[0]?.estoque,erpOrder:link.rows,reservation:hold.rows});
  }else throw Error('Etapa inválida.');
 }finally{await Promise.all([store.end(),erp.end()]);}
}
main().catch(e=>{console.error(String(e.message).replace(/https?:\/\/\S+/g,'[URL]'));process.exitCode=1;});
