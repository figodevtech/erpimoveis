import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { reconcileCheckout } from '@/lib/checkout-reconcile';

// A checkout may have a valid charge/reservation without being an order yet.
export async function pendingCheckoutStatus(reference:number,customer:number) {
 const {data:attempt,error}=await supabaseAdmin.from('checkout_attempt').select('phase,payment_id,created_at,checkout_payload,payment_data').eq('order_id',reference).eq('cliente_id',customer).maybeSingle();
 if(error)throw error;
 if(!attempt)return null;
 if(attempt.phase!=='CANCELLED') {
  try {await reconcileCheckout(reference);}catch {console.warn('[checkout/status] Conciliação pendente',{reference});}
 }
 const [{data:order,error:orderError},{data:current,error:attemptError}]=await Promise.all([
  supabaseAdmin.from('venda').select('status,valortotal,forma_pagamento,createdat').eq('id',reference).eq('clienteid',customer).maybeSingle(),
  supabaseAdmin.from('checkout_attempt').select('phase,payment_data').eq('order_id',reference).eq('cliente_id',customer).single(),
 ]);
 if(orderError)throw orderError;
 if(attemptError)throw attemptError;
 const cancelled=current.phase==='CANCELLED'||current.payment_data?.status==='REFUNDED';
 const status=order?.status||(cancelled?'CANCELADO':'PENDENTE');
 return {orderId:reference,status,isPaid:['PAGO','FINALIZADA'].includes(status),isAuthorized:status==='AUTORIZADO',isPending:['PENDENTE','AUTORIZADO'].includes(status),isCancelled:status==='CANCELADO',total:Number(order?.valortotal??attempt.checkout_payload?.total??0),paymentMethod:order?.forma_pagamento||attempt.checkout_payload?.method||'Asaas',date:order?.createdat||attempt.created_at};
}
