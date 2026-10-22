import { NextResponse } from 'next/server';
import { requireVendasAccess,requireVendasCreate } from '@/app/api/_authz/perms';
import { errorStatus,requireEmpresaId } from '@/lib/empresa-context';
import { storefrontFetch } from '@/lib/integrations/storefront-http';
import { reconcileSiteCheckouts } from '@/lib/integrations/site-checkout-reconcile';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET() {
 try {
  await requireVendasAccess();
  const company=await requireEmpresaId();
  const base=process.env.STOREFRONT_API_URL?.trim().replace(/\/+$/,'');
  const secret=process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim();
  if(!base||!secret)return NextResponse.json({data:[],warning:'Loja não configurada.'});
  const response=await storefrontFetch(`${base}/api/integrations/erp/checkout/reconcile`,{headers:{Authorization:`Bearer ${secret}`},cache:'no-store',signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error('Não foi possível consultar as tentativas de pagamento da loja.');
  const {data,legacy}=await response.json();
  const ids=(data||[]).map((row:{order_id:number})=>row.order_id);
  const {data:holds,error}=ids.length?await supabaseAdmin.from('site_checkout').select('site_order_id,state,items').eq('empresa_id',company).in('site_order_id',ids):{data:[],error:null};
  if(error)throw error;
  const byOrder=new Map((holds||[]).map(row=>[Number(row.site_order_id),row]));
  return NextResponse.json({data:(data||[]).map((row:{order_id:number})=>({...row,reservation:byOrder.get(Number(row.order_id))||null})),warning:Number(legacy?.pending)>0?`${legacy.pending} pedido(s) antigo(s) pendente(s), ${legacy.withPayment} com cobrança vinculada. Concilie esses pedidos antes de liberar o novo checkout.`:null},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Falha ao consultar reservas.'},{status:errorStatus(error)});}
}
export async function POST() {
 try {await requireVendasCreate();return NextResponse.json(await reconcileSiteCheckouts());}
 catch(error){return NextResponse.json({error:'Não foi possível conciliar agora.'},{status:errorStatus(error)});}
}
