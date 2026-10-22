import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { reconcileCheckoutBatch } from '@/lib/checkout-reconcile';
import { supabaseAdmin } from '@/lib/supabase/admin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
function authorized(request:Request) {
 const secret=process.env.ERP_ORDER_SYNC_SECRET?.trim();
 const expected=`Bearer ${secret||''}`,received=request.headers.get('authorization')||'';
 return Boolean(secret && Buffer.byteLength(expected)===Buffer.byteLength(received) && timingSafeEqual(Buffer.from(expected),Buffer.from(received)));
}
export async function GET(request:Request) {
 if(!authorized(request))return NextResponse.json({error:'NAO_AUTORIZADO'},{status:401});
 if(new URL(request.url).searchParams.get('view')==='orders') {
  const offset=Number(new URL(request.url).searchParams.get('offset')||0);
  if(!Number.isSafeInteger(offset)||offset<0)return NextResponse.json({error:'PAGINACAO_INVALIDA'},{status:400});
  // Expose operational order details only; never return payment tokens or metadata.
  const {data,error}=await supabaseAdmin.from('checkout_attempt')
   .select('order_id,phase,billing_type,payment_id,payment_data,checkout_payload,created_at,updated_at,reconciled_at,bank_cancelled_at,release_pending,cliente:cliente_id(nomerazaosocial,cpfcnpj,email,telefone)')
   .not('payment_id','is',null).neq('phase','DONE').order('created_at',{ascending:false}).order('order_id',{ascending:false}).range(offset,offset+99);
  if(error)return NextResponse.json({error:'Falha ao consultar compras.'},{status:503});
  const ids=[...new Set((data||[]).flatMap(row=>(row.checkout_payload?.items||[]).map((item:{produtoid:number})=>item.produtoid)))];
  const products=ids.length?await supabaseAdmin.from('produto').select('id,titulo,tituloMarketplace,referencia').in('id',ids):{data:[],error:null};
  if(products.error)return NextResponse.json({error:'Falha ao consultar itens da compra.'},{status:503});
  const byId=new Map((products.data||[]).map(product=>[Number(product.id),product]));
  return NextResponse.json({data:(data||[]).map(row=>({
   orderId:row.order_id,phase:row.phase,paymentMethod:row.billing_type,paymentStatus:row.payment_data?.status,
   total:row.checkout_payload?.total,subtotal:row.checkout_payload?.subtotal,address:row.checkout_payload?.address,
   items:(row.checkout_payload?.items||[]).map((item:{produtoid:number;quantidade:number;valor_total?:number})=>{
    const product=byId.get(Number(item.produtoid));
    return {produtoid:item.produtoid,quantidade:item.quantidade,valor_total:item.valor_total,title:product?.tituloMarketplace||product?.titulo||`Produto #${item.produtoid}`,reference:product?.referencia};
   }),customer:(()=>{const customer=Array.isArray(row.cliente)?row.cliente[0]:row.cliente;return {name:customer?.nomerazaosocial,document:customer?.cpfcnpj,email:customer?.email,phone:customer?.telefone};})(),
   dueDate:row.payment_data?.dueDate,updatedAt:row.updated_at,reconciledAt:row.reconciled_at,bankCancelledAt:row.bank_cancelled_at,
   createdAt:row.created_at,releasePending:row.release_pending,
  }))},{headers:{'Cache-Control':'no-store'}});
 }
 const {data,error}=await supabaseAdmin.from('checkout_attempt').select('order_id,phase,billing_type,last_error,created_at,updated_at,bank_cancelled_at,release_pending').or('phase.not.in.(CANCELLED,DONE),release_pending.eq.true').order('created_at',{ascending:false}).limit(100);
 if(error)return NextResponse.json({error:'Falha ao consultar checkouts.'},{status:503});
 const {data:legacy,error:legacyError}=await supabaseAdmin.rpc('fn_checkout_cutover_status');
 if(legacyError)return NextResponse.json({error:'Falha ao conferir a transição de estoque.'},{status:503});
 return NextResponse.json({data,legacy},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request) {
 if(!authorized(request))return NextResponse.json({error:'NAO_AUTORIZADO'},{status:401});
 try {const results=await reconcileCheckoutBatch();return NextResponse.json({results});}
 catch {return NextResponse.json({error:'Conciliação pendente. A próxima execução tentará novamente.'},{status:503});}
}
