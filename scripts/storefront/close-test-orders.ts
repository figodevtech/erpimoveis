import {parseSimpleEnv} from '../db/lib';

const apply=process.argv.includes('--apply');
const remaining=process.argv.includes('--remaining');
const targets=[{site:'site_brpecaspb',ref:'omicuflzwpajzainwboq',ids:remaining?[1,2,3,4,5]:[6,7]},{site:'site_demirdiesel',ref:'ohlylsxvvughgedgcimg',ids:remaining?[1,2,3,4,6,7,8,9,10,11,12,13,14,15,16,17,18,19]:[31]}];
async function main(){
 for(const target of targets){
  const env=new Map([...parseSimpleEnv(`${target.site}/.env`),...parseSimpleEnv(`${target.site}/.env.local`)]);
  const store=env.get('NEXT_PUBLIC_STORE_SUPABASE_URL')!;
  const service=env.get('STORE_SUPABASE_SERVICE_ROLE_KEY')!;
  if(new URL(store).hostname!==`${target.ref}.supabase.co`)throw Error('Projeto inesperado.');
  const provider=(env.get('ASAAS_API_URL')||(env.get('ASAAS_ENVIRONMENT')?.trim().toLowerCase()==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3')).replace(/\/+$/,'');
  if(!['api.asaas.com','api-sandbox.asaas.com'].includes(new URL(provider).hostname))throw Error('Provedor inesperado.');
  const token=env.get('ASAAS_API_KEY')!.replaceAll('\\$','$');
  async function request(base:string,path:string,headers:Record<string,string>,method='GET',body?:unknown){
   const response=await fetch(base+path,{method,headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
   const result=await response.json().catch(()=>null);
   if(!response.ok)throw Error(`${target.site}: ${method} HTTP ${response.status}`);
   return result;
  }
  const storeHeaders={apikey:service,Authorization:`Bearer ${service}`,Prefer:'return=representation'};
  const providerHeaders={access_token:token};
  for(const id of target.ids){
   const rows=await request(store,`/rest/v1/venda?id=eq.${id}&select=id,status,gateway_payment_id,estoque_baixado,observacao,cliente:clienteid(asaas_customer_id)`,storeHeaders);
   if(rows.length!==1)throw Error(`${target.site} #${id}: pedido não encontrado.`);
   const order=rows[0];
   if(order.estoque_baixado)throw Error(`${target.site} #${id}: possui baixa de estoque; revisão necessária.`);
   if(!['PENDENTE','CANCELADO'].includes(order.status)||(!remaining&&!order.gateway_payment_id))throw Error(`${target.site} #${id}: estado inesperado.`);
   let payment:any=null;
   if(order.gateway_payment_id){
    const lookup=await fetch(`${provider}/payments/${encodeURIComponent(order.gateway_payment_id)}`,{headers:providerHeaders,redirect:'error',signal:AbortSignal.timeout(20000)});
    if(lookup.ok)payment=await lookup.json();
    else if(lookup.status!==404)throw Error(`${target.site} #${id}: consulta HTTP ${lookup.status}`);
   }
   if(remaining){
    const list=await request(provider,`/payments?externalReference=${id}&limit=100`,providerHeaders);
    if(list.hasMore)throw Error(`${target.site} #${id}: resultado financeiro incompleto.`);
    const matched=list.data||[];
    if(matched.length>1)throw Error(`${target.site} #${id}: mais de uma cobrança encontrada.`);
    if(matched.length===1){
     if(!order.cliente?.asaas_customer_id||matched[0].customer!==order.cliente.asaas_customer_id)throw Error(`${target.site} #${id}: cadastro financeiro divergente; revisão necessária.`);
     if(payment&&payment.id!==matched[0].id)throw Error(`${target.site} #${id}: vínculo de cobrança divergente.`);
     payment=matched[0];
    }
   }
   if(payment&&(String(payment.externalReference)!==String(id)||!['PIX','CREDIT_CARD'].includes(payment.billingType)||!['PENDING','OVERDUE'].includes(payment.status)))throw Error(`${target.site} #${id}: cobrança mudou; não cancelar automaticamente.`);
   console.log(target.site,id,{status:payment?.status||'SEM_COBRANCA_NA_CONTA_ATUAL',deleted:!!payment?.deleted,mode:apply?'apply':'inspect'});
   if(!apply)continue;
   if(payment&&!payment.deleted){
    const path=`/payments/${encodeURIComponent(payment.id)}`;
    const result=await request(provider,path,providerHeaders,'DELETE');
    if(result.deleted!==true)throw Error(`${target.site} #${id}: cancelamento não confirmado.`);
    payment=await request(provider,path,providerHeaders);
   }
   if(payment&&(payment.deleted!==true||!['PENDING','OVERDUE'].includes(payment.status)))throw Error(`${target.site} #${id}: conciliação financeira inconclusiva.`);
   if(order.status!=='CANCELADO'){
    const note=`[Pedido de teste confirmado pelo responsável] ${payment?'Cobrança cancelada no Asaas':'Nenhuma cobrança encontrada na conta Asaas configurada; tentativa de teste encerrada'} em ${new Date().toISOString()}.`;
    const paymentFilter=order.gateway_payment_id?`eq.${encodeURIComponent(order.gateway_payment_id)}`:'is.null';
    const updated=await request(store,`/rest/v1/venda?id=eq.${id}&status=eq.PENDENTE&estoque_baixado=eq.false&gateway_payment_id=${paymentFilter}`,storeHeaders,'PATCH',{status:'CANCELADO',...(payment?{gateway_status:'DELETED'}:{}),updatedat:new Date().toISOString(),observacao:[order.observacao,note].filter(Boolean).join('\n')});
    if(updated.length!==1)throw Error(`${target.site} #${id}: estado local mudou; verificar pedido.`);
   }
   const verified=await request(store,`/rest/v1/venda?id=eq.${id}&select=id,status,estoque_baixado`,storeHeaders);
   if(verified[0]?.status!=='CANCELADO'||verified[0]?.estoque_baixado!==false)throw Error(`${target.site} #${id}: verificação local falhou.`);
   console.log(target.site,id,payment?'CANCELADO no provedor e no site; estoque não alterado.':'Teste encerrado no site; sem cobrança na conta configurada; estoque não alterado.');
  }
 }
}
main().catch(error=>{console.error(error.cause?.code||error.message);process.exitCode=1;});
