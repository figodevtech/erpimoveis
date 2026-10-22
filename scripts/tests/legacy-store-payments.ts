import {connectDatabase,parseSimpleEnv} from '../db/lib';
import {storeConfig} from '../storefront/checkout-migrations';
async function main() {
 for(const site of ['site_brpecaspb','site_demirdiesel']) {
  const env=new Map([...parseSimpleEnv(`${site}/.env`),...parseSimpleEnv(`${site}/.env.local`)]);
  let orders:Array<{id:number;gateway_payment_id:string|null}>=[];
  if(site==='site_brpecaspb') {
   const {client}=await connectDatabase(storeConfig(site));
   try {orders=(await client.query("select id,gateway_payment_id from venda where status::text='PENDENTE' order by id limit 100")).rows;}
   finally{await client.end();}
  }else{
   const base=env.get('NEXT_PUBLIC_STORE_SUPABASE_URL')!;
   const key=env.get('STORE_SUPABASE_SERVICE_ROLE_KEY')!;
   if(new URL(base).hostname!=='ohlylsxvvughgedgcimg.supabase.co')throw new Error('Unexpected project.');
   const response=await fetch(`${base}/rest/v1/venda?select=id,gateway_payment_id&status=eq.PENDENTE&limit=100`,{headers:{apikey:key,Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(`Store inspection failed: ${response.status}`);
   orders=await response.json();
  }
  console.log(site,'pending local orders:',orders.length,'with payment:',orders.filter(o=>o.gateway_payment_id).length);
  const base=env.get('ASAAS_API_URL')||(env.get('ASAAS_ENVIRONMENT')==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3');
  if(!['api.asaas.com','api-sandbox.asaas.com'].includes(new URL(base).hostname))throw new Error('Unexpected payment provider.');
  // Next's env loader unescapes literal dollar signs in provider tokens.
  const key=env.get('ASAAS_API_KEY')!.replaceAll('\\$','$');
  for(const order of orders.filter(o=>o.gateway_payment_id).slice(0,10)) {
   const response=await fetch(`${base.replace(/\/+$/,'')}/payments/${encodeURIComponent(order.gateway_payment_id!)}`,{headers:{access_token:key},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok){console.log(site,'order',order.id,'provider HTTP',response.status);continue;}
   const payment=await response.json();
   console.log(site,'order',order.id,{status:payment.status,deleted:payment.deleted||false,billingType:payment.billingType,dueDate:payment.dueDate});
  }
 }
}
main().catch(error=>{console.error('Read-only inspection failed:',error.cause?.code||error.message?.replace(/https?:\/\/\S+/g,'[URL]'));process.exitCode=1;});
