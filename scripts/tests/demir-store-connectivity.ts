import {parseSimpleEnv} from '../db/lib';
async function main() {
 const values=new Map([...parseSimpleEnv('site_demirdiesel/.env'),...parseSimpleEnv('site_demirdiesel/.env.local')]);
 const base=values.get('NEXT_PUBLIC_STORE_SUPABASE_URL');
 const key=values.get('STORE_SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!key||new URL(base).hostname!=='ohlylsxvvughgedgcimg.supabase.co')throw new Error('Configuração do projeto não reconhecida.');
 const response=await fetch(`${base}/rest/v1/produto?select=id&limit=0`,{headers:{apikey:key,Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(15000)});
 console.log('Demir store REST connectivity:',response.status);
 if(!response.ok) {
  const payload=await response.json().catch(()=>({}));
  console.log('Service response:',payload.code||payload.error||payload.message||'Unavailable');
 }
}
main().catch(error=>{console.error('Connectivity failed:',error.cause?.code||error.name);process.exitCode=1;});
