import { storefrontFetch } from '@/lib/integrations/storefront-http';
export async function reconcileSiteCheckouts() {
 const base=process.env.STOREFRONT_API_URL?.trim().replace(/\/+$/,'');
 const secret=process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim();
 if(!base || !secret)return {skipped:true};
 const response=await storefrontFetch(`${base}/api/integrations/erp/checkout/reconcile`,{method:'POST',headers:{Authorization:`Bearer ${secret}`},cache:'no-store',signal:AbortSignal.timeout(180_000)});
 if(!response.ok)throw new Error('Falha ao conciliar reservas da loja.');
 return response.json();
}
