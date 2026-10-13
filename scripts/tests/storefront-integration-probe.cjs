const path=require('node:path');
const {loadEnvConfig,resetEnv}=require('@next/env');
const quiet={info(){},error(){}};
const store={...loadEnvConfig(path.resolve('site_demirdiesel'),true,quiet,true).combinedEnv};
resetEnv();
const erp={...loadEnvConfig(process.cwd(),true,quiet,true).combinedEnv};
async function probe(label,url,headers,summary){
 try {
  const response=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
  const body=await response.text();let data;try{data=JSON.parse(body);}catch{}
  console.log(JSON.stringify({label,status:response.status,json:!!data,...(response.ok&&data?summary(data):{})}));
 }catch(e){console.log(JSON.stringify({label,unavailable:true,code:e.cause?.code||e.name}));}
}
(async()=>{
 console.log(JSON.stringify({label:'Secret loja/ERP',configured:!!store.ERP_ORDER_SYNC_SECRET&&!!erp.STOREFRONT_ORDER_SYNC_SECRET,matching:!!store.ERP_ORDER_SYNC_SECRET&&store.ERP_ORDER_SYNC_SECRET===erp.STOREFRONT_ORDER_SYNC_SECRET,erpTargetsStorePort3002:erp.STOREFRONT_API_URL==='http://localhost:3002'}));
 await probe('Loja: exportacao sem token','http://localhost:3002/api/integrations/erp/orders',{},()=>({}));
 if(erp.STOREFRONT_ORDER_SYNC_SECRET)await probe('Loja: exportacao autenticada','http://localhost:3002/api/integrations/erp/orders?limit=1',{Authorization:'Bearer '+erp.STOREFRONT_ORDER_SYNC_SECRET},d=>({orders:Array.isArray(d.data)?d.data.length:null,count:d.count}));
 if(store.CENTRAL_STOREFRONT_CONFIG_URL&&store.CENTRAL_INSTALLATION_ID&&store.CENTRAL_STOREFRONT_TOKEN){
  const url=new URL(store.CENTRAL_STOREFRONT_CONFIG_URL);url.searchParams.set('installationId',store.CENTRAL_INSTALLATION_ID);
  console.log(JSON.stringify({label:'Rotas configuradas',centralOrigin:url.origin,centralPath:url.pathname,erpStoreOrigin:new URL(erp.STOREFRONT_API_URL).origin,asaasEnvironment:store.ASAAS_ENVIRONMENT||'sandbox'}));
  await probe('Central: configuracao autenticada',url,{Authorization:'Bearer '+store.CENTRAL_STOREFRONT_TOKEN},d=>({revision:d.revision,commissionEnabled:d.commission?.enabled,percent:d.commission?.percent,walletConfigured:!!d.commission?.walletId}));
 }else console.log(JSON.stringify({label:'Central: configuracao',missingVariables:true}));
 const base=String(store.ASAAS_API_URL||((store.ASAAS_ENVIRONMENT||'sandbox').trim().toLowerCase()==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3')).replace(/\/$/,'');
 if(base.includes('sandbox')&&store.ASAAS_API_KEY)await probe('Asaas: chave Sandbox leitura',base+'/payments?limit=1',{access_token:store.ASAAS_API_KEY.trim()},d=>({readable:Array.isArray(d.data)}));
 else console.log(JSON.stringify({label:'Asaas: chave Sandbox',skipped:true,reason:'Sandbox nao confirmado na URL explicita'}));
})().catch(()=>{process.exitCode=1;});
