import {parseSimpleEnv} from '../db/lib';
async function main(){
 for(const site of ['site_brpecaspb','site_demirdiesel']){
  const env=new Map([...parseSimpleEnv(`${site}/.env`),...parseSimpleEnv(`${site}/.env.local`)]);
  const base=env.get('NEXT_PUBLIC_STORE_SUPABASE_URL')!,key=env.get('STORE_SUPABASE_SERVICE_ROLE_KEY')!;
  const expected=site==='site_brpecaspb'?'omicuflzwpajzainwboq':'ohlylsxvvughgedgcimg';
  if(new URL(base).hostname!==`${expected}.supabase.co`)throw Error('Projeto inesperado.');
  const response=await fetch(`${base}/rest/v1/venda?status=eq.PENDENTE&select=id,estoque_baixado,gateway_payment_id&order=id&limit=100`,{headers:{apikey:key,Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const rows=await response.json();
  console.log(site,rows.map((row:{id:number;estoque_baixado:boolean;gateway_payment_id:string|null})=>({id:row.id,stockDebited:row.estoque_baixado,hasPayment:!!row.gateway_payment_id})));
 }
}
main().catch(error=>{console.error(error.cause?.code||error.message);process.exitCode=1;});
