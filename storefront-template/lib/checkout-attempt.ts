import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { erpCheckout } from '@/lib/erp-checkout';
import type { AsaasPayment } from '@/lib/asaas';

export function attemptIdentity(attempt:unknown,customer:number,address:unknown,delivery:string,billing:string,savedCard:unknown,items:Map<number,number>) {
  if (typeof attempt!=='string' || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(attempt)) throw new Error('Atualize a página para iniciar o pagamento com segurança.');
  const hash=createHash('sha256').update(JSON.stringify([customer,String(address),delivery,billing,savedCard||null,[...items].sort((a,b)=>a[0]-b[0])])).digest('hex');
  return {attempt,hash};
}
export async function resumeCheckout(attempt:string,customer:number,hash:string) {
  const {data:initial,error}=await supabaseAdmin.from('checkout_attempt').select('order_id,cliente_id,request_hash,phase,checkout_payload,payment_data').eq('attempt_id',attempt).maybeSingle();
  let data=initial;
  if (error) throw error;
  if (!data) {
    const active=await supabaseAdmin.from('checkout_attempt').select('order_id,cliente_id,request_hash,phase,checkout_payload,payment_data').eq('cliente_id',customer).eq('request_hash',hash).not('phase','in','(CANCELLED,DONE)').maybeSingle();
    if(active.error)throw active.error;
    data=active.data;
  }
  if (!data) return null;
  if (Number(data.cliente_id)!==Number(customer) || data.request_hash!==hash) return NextResponse.json({message:'Esta tentativa pertence a outro pedido. Atualize a página.'},{status:409});
  if (data.phase==='CANCELLED') return NextResponse.json({message:'Esta tentativa foi encerrada. Você pode iniciar uma nova compra.',retryable:true},{status:409});
  return NextResponse.json({orderId:data.order_id,url:data.payment_data?.url||null,directPayment:true,resumed:true,gatewayStatus:data.payment_data?.status||'PENDING',total:data.checkout_payload?.total,subtotal:data.checkout_payload?.subtotal,paymentMethod:data.checkout_payload?.method},{status:data.phase==='BOUND'||data.phase==='DONE'?200:202});
}
export async function bindCheckoutPayment(orderId:number,payment:AsaasPayment) {
  const {data,error}=await supabaseAdmin.rpc('fn_checkout_bind',{p_order:orderId,p_payment:payment.id,p_customer:payment.customer||'',p_total:payment.value??0,p_billing:payment.billingType||'',p_due:payment.dueDate||null,p_url:payment.invoiceUrl||null,p_status:payment.status||'PENDING'});
  if (error) throw error;
  return Boolean(data);
}
export async function releaseCancelledCheckout(orderId:number,reason:string) {
  await erpCheckout({action:'release',orderId,reason});
  const {error}=await supabaseAdmin.from('checkout_attempt').update({release_pending:false,reconciled_at:new Date().toISOString()}).eq('order_id',orderId).eq('phase','CANCELLED');
  if(error) throw error;
}
export async function checkoutFailed(orderId:number,definite:boolean) {
  const {data,error}=await supabaseAdmin.rpc('fn_checkout_fail',{p_order:orderId,p_definite:definite});
  if(error) throw error;
  if(data) await releaseCancelledCheckout(orderId,'Falha antes da cobrança ou rejeição definitiva do provedor');
  return Boolean(data);
}
