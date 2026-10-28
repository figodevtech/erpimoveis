import 'server-only';
import { checkoutPolicySchema,defaultCheckoutPolicy } from '@/lib/checkout-policy';
export async function getCheckoutPolicy(ids:number[]=[]){
 const fallback={policies:Object.fromEntries(ids.map(id=>[String(id),defaultCheckoutPolicy])),revision:'default',available:false,originCep:null as string|null};
 const webhook=process.env.ERP_ORDER_WEBHOOK_URL?.trim(),secret=process.env.ERP_ORDER_SYNC_SECRET?.trim();
 if(!webhook||!secret||!ids.length)return fallback;
 try{
 const base=new URL(webhook);if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw Error();
 const url=new URL('/api/integracoes/site/checkout-config',base);url.searchParams.set('ids',ids.join(','));
 const r=await fetch(url,{headers:{Authorization:`Bearer ${secret}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error();const body=await r.json();const policies=Object.fromEntries(ids.map(id=>[String(id),checkoutPolicySchema.parse(body.policies?.[String(id)]||defaultCheckoutPolicy)]));
 return {policies,revision:String(body.revision),available:true,originCep:typeof body.originCep==='string'&&/^\d{8}$/.test(body.originCep)?body.originCep:null};
 }catch{return fallback;}
}
