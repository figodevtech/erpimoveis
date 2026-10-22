import { storefrontFetch } from './storefront-http';

type PendingCheckout = {
 orderId:number;phase:string;paymentMethod:string;paymentStatus?:string;
 total:number;subtotal?:number;address?:Record<string,unknown>;
 items?:Array<{produtoid:number;quantidade:number;valor_total?:number;title?:string;reference?:string}>;
 customerName?:string;customer?:{name?:string;document?:string;email?:string;phone?:string};
 dueDate?:string;updatedAt?:string;reconciledAt?:string;bankCancelledAt?:string;createdAt:string;releasePending:boolean;
};

export async function fetchPendingSiteOrders() {
 const base=process.env.STOREFRONT_API_URL?.trim().replace(/\/+$/,'');
 const secret=process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim();
 if(!base||!secret)return [];
 const attempts:PendingCheckout[]=[];
 for(let offset=0;;offset+=100) {
  const response=await storefrontFetch(`${base}/api/integrations/erp/checkout/reconcile?view=orders&offset=${offset}`,{
   headers:{Authorization:`Bearer ${secret}`},cache:'no-store',signal:AbortSignal.timeout(15_000),
  });
  if(!response.ok)throw new Error('Não foi possível consultar as compras aguardando pagamento.');
  const result=await response.json();
  if(!Array.isArray(result.data))throw new Error('Resposta inválida ao consultar compras.');
  const batch=result.data as PendingCheckout[];
  // Reject an older deployment that ignores view/offset instead of looping forever.
  if(batch.some(row=>!Number.isSafeInteger(row.orderId)))throw new Error('Atualize a integração de pedidos no site.');
  attempts.push(...batch);
  if(batch.length<100)break;
 }
 return attempts.map(row=>({
  id:-row.orderId,site_order_id:row.orderId,checkout_pending:true,
  site_status:row.phase==='CANCELLED'?'CANCELADO':row.phase==='REVIEW'?'REVISAO_NECESSARIA'
   :['AUTHORIZED','AWAITING_RISK_ANALYSIS'].includes(row.paymentStatus||'')?'PAGAMENTO_EM_ANALISE'
   :['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(row.paymentStatus||'')?'PAGAMENTO_CONFIRMADO':'AGUARDANDO_PAGAMENTO',
  total_amount:Number(row.total)||0,order_created_at:row.createdAt,import_status:'PENDENTE',
  paymentMethod:row.paymentMethod,subtotal:row.subtotal,customer:row.customer||{name:row.customerName},
  payment_due_date:row.dueDate,checkout_updated_at:row.updatedAt,payment_checked_at:row.reconciledAt,bank_cancelled_at:row.bankCancelledAt,stock_release_pending:row.releasePending,
  venda:null,invoice:null,raw_order:{shippingAddress:row.address||{},customer:row.customer||{name:row.customerName},paymentMethod:row.paymentMethod,subtotal:row.subtotal,
   items:(row.items||[]).map(item=>({produtoId:item.produtoid,quantidade:item.quantidade,valorTotal:item.valor_total,title:item.title,reference:item.reference}))},
  nextAction:row.releasePending?'Aguardando liberação segura do estoque.':row.phase==='CANCELLED'?'Compra cancelada.':row.phase==='REVIEW'?'Conferir pagamento na conciliação.':['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(row.paymentStatus||'')?'Aguardar importação da venda paga.':'Aguardar confirmação do pagamento.',
 }));
}
