import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { asaasRequest, getAsaasPayment, cancelAsaasPayment, type AsaasPayment } from '@/lib/asaas';
import { bindCheckoutPayment, releaseCancelledCheckout } from '@/lib/checkout-attempt';
import { erpCheckout } from '@/lib/erp-checkout';

const paid=new Set(['RECEIVED','CONFIRMED','RECEIVED_IN_CASH']);
class ManualCheckoutReview extends Error {}
const latePaymentMessage='Pagamento recebido após cancelamento. Não liberar estoque; revisão manual obrigatória.';
export function bankSettlementDeadline(cancelledAt:string):number {
  // Count from the bank's actual cancellation acknowledgement (not merely the
  // due date). End of the third business day adds a day to the 2-day SLA.
  const start=new Date(cancelledAt);
  if(!Number.isFinite(start.getTime())) return Infinity;
  const day=new Date(`${start.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})}T12:00:00Z`);
  let count=0;
  while(count<3) {day.setUTCDate(day.getUTCDate()+1);if(isBankDay(day))count++;}
  return Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()+1,3);
}
function isBankDay(day:Date) {
  if(day.getUTCDay()===0 || day.getUTCDay()===6) return false;
  const year=day.getUTCFullYear();
  // Gregorian Easter (Meeus), used for the Brazilian clearing holidays.
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),date=(h+l-7*m+114)%31+1;
  const easter=Date.UTC(year,month-1,date,12);
  const fixed=['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-24','12-25','12-31'];
  if(fixed.includes(day.toISOString().slice(5,10))) return false;
  return ![-48,-47,-2,60].some(offset=>new Date(easter+offset*86400000).toISOString().slice(0,10)===day.toISOString().slice(0,10));
}
export async function notifyErpOrder(orderId:number) {
  const url=process.env.ERP_ORDER_WEBHOOK_URL?.trim();
  const secret=process.env.ERP_ORDER_SYNC_SECRET?.trim();
  if(!url || !secret) throw new Error('Integração ERP não configurada.');
  const response=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({orderId}),cache:'no-store',signal:AbortSignal.timeout(20_000)});
  if(!response.ok) throw new Error('Sincronização do pedido com o ERP pendente.');
}
async function attemptUpdate(orderId:number,values:Record<string,unknown>) {
  const {error}=await supabaseAdmin.from('checkout_attempt').update(values).eq('order_id',orderId);
  if(error) throw error;
}
export async function reconcileCheckout(orderId:number,provided?:AsaasPayment,eventType?:string) {
  const {data:attempt,error}=await supabaseAdmin.from('checkout_attempt').select('*').eq('order_id',orderId).maybeSingle();
  if(error) throw error;
  if(!attempt) return false;
  if(attempt.phase==='REVIEW' && attempt.last_error===latePaymentMessage)throw new ManualCheckoutReview(latePaymentMessage);
  if(attempt.release_pending) {
    const latest=provided || (attempt.payment_id?await getAsaasPayment(attempt.payment_id):null);
    if(latest && paid.has(latest.status||'')) {
      await attemptUpdate(orderId,{phase:'REVIEW',last_error:latePaymentMessage});
      throw new ManualCheckoutReview(latePaymentMessage);
    }
    await releaseCancelledCheckout(orderId,'Cancelamento conciliado');return true;
  }
  if(attempt.phase==='CANCELLED') {
    // A restored/late paid payment must remain visible for manual resolution.
    if(provided && paid.has(provided.status||'')) {
      await attemptUpdate(orderId,{phase:'REVIEW',last_error:latePaymentMessage});
      throw new ManualCheckoutReview(latePaymentMessage);
    }
    return true;
  }
  if(attempt.phase==='PREPARING') {
    const {data:abandoned,error:abandonError}=await supabaseAdmin.rpc('fn_checkout_abandon',{p_order:orderId});
    if(abandonError)throw abandonError;
    if(abandoned)await releaseCancelledCheckout(orderId,'Checkout abandonado antes de enviar a cobrança');
    return true;
  }
  let payment=provided;
  if(!payment && attempt.payment_id)payment=await getAsaasPayment(attempt.payment_id);
  if(!payment && attempt.expected_customer) {
    const query=new URLSearchParams({customer:attempt.expected_customer,externalReference:String(orderId),limit:'100'});
    const list=await asaasRequest<{data:AsaasPayment[];hasMore?:boolean}>(`/payments?${query}`);
    if(list.hasMore || (list.data.length>1 && (!list.data[0]?.installment || !list.data.every(p=>p.installment===list.data[0].installment)))) {
      await attemptUpdate(orderId,{phase:'REVIEW',last_error:'Mais de uma cobrança encontrada. Revisão obrigatória.'});
      throw new Error('Cobranças conflitantes.');
    }
    payment=list.data[0] ? await getAsaasPayment(list.data[0].id) : undefined;
  }
  if(!payment) {
    // Absence from a list is not proof that a timed-out POST cannot commit.
    if(Date.now()-Date.parse(attempt.created_at)>20*60_000)await attemptUpdate(orderId,{phase:'REVIEW',last_error:'Envio sem resposta definitiva. Conferir provedor; estoque permanece reservado.'});
    return true;
  }
  if(payment.installmentGroupDeleted&&attempt.payment_id&&attempt.payment_id!==payment.id){
    const primary=await getAsaasPayment(attempt.payment_id);
    if(!primary.installmentGroupDeleted||primary.installment!==payment.installment)throw new Error('Parcelamento divergente.');
    payment=primary;
  }
  if(String(payment.externalReference)!==String(orderId))throw new Error('Referência de pagamento divergente.');
  await bindCheckoutPayment(orderId,payment);
  await attemptUpdate(orderId,{last_error:null});
  let cancelledAt=attempt.bank_cancelled_at as string|null;
  if(attempt.billing_type==='BOLETO' && (eventType==='PAYMENT_BANK_SLIP_CANCELLED' || payment.deleted) && !cancelledAt) {
    cancelledAt=new Date().toISOString();
    await attemptUpdate(orderId,{bank_cancelled_at:cancelledAt});
  }
  const status=payment.status||'PENDING';
  if(paid.has(status)) {
    const {error:processError}=await supabaseAdmin.rpc('fn_processar_evento_pagamento_asaas',{p_event_id:`CENTRAL-${payment.id}-${status}`,p_event_type:eventType||'RECONCILE',p_payment_id:payment.id,p_venda_id:orderId,p_gateway_status:status,p_novo_status:'PAGO',p_forma_pagamento:attempt.billing_type});
    if(processError)throw processError;
    await notifyErpOrder(orderId);
    await attemptUpdate(orderId,{phase:'DONE',last_error:null});
    return true;
  }
  // Refunded sales use the ERP's existing financial/physical return workflow.
  if(status==='REFUNDED') {
    const {data:existingOrder,error:orderError}=await supabaseAdmin.from('venda').select('id').eq('id',orderId).maybeSingle();
    if(orderError)throw orderError;
    if(existingOrder) {
    const {error:processError}=await supabaseAdmin.rpc('fn_processar_evento_pagamento_asaas',{p_event_id:`CENTRAL-${payment.id}-REFUNDED`,p_event_type:eventType||'RECONCILE',p_payment_id:payment.id,p_venda_id:orderId,p_gateway_status:status,p_novo_status:'CANCELADO',p_forma_pagamento:attempt.billing_type});
    if(processError)throw processError;
    await notifyErpOrder(orderId);
    }
    // Serializes with paid import in the ERP. If a final sale already exists,
    // only its existing physical-return workflow can restore that inventory.
    await erpCheckout({action:'refundReservation',orderId});
    await attemptUpdate(orderId,{phase:'DONE',last_error:null});
    return true;
  }
  if(attempt.phase==='DONE')return true;
  const elapsed=Date.now()-Date.parse(attempt.created_at);
  const boleto=attempt.billing_type==='BOLETO';
  if(boleto && status==='OVERDUE' && !cancelledAt && elapsed>7*86400000) {
    await attemptUpdate(orderId,{phase:'REVIEW',last_error:'Boleto vencido sem confirmação de baixa bancária. Confira o evento PAYMENT_BANK_SLIP_CANCELLED no webhook do Asaas; estoque mantido reservado.'});
    return true;
  }
  const canCancel=boleto
    ? Boolean(cancelledAt && Date.now()>bankSettlementDeadline(cancelledAt))
    : elapsed>(attempt.billing_type==='PIX'?30:60)*60_000;
  if(!canCancel || (!payment.deleted && !['PENDING','OVERDUE'].includes(status))) return true;
  if(!payment.deleted) {
    payment=await cancelAsaasPayment(payment);
  }
  if(!payment.deleted || paid.has(payment.status||''))throw new Error('Cancelamento financeiro inconclusivo.');
  const {error:cancelError}=await supabaseAdmin.rpc('fn_checkout_cancel_bound',{p_order:orderId,p_payment:payment.id});
  if(cancelError)throw cancelError;
  await releaseCancelledCheckout(orderId,'Cobrança cancelada no Asaas; prazo de compensação respeitado');
  return true;
}
export async function reconcileCheckoutBatch() {
  const started=Date.now();
  // Persisted resource IDs survive a webhook timeout/restart. No card/customer
  // payload is stored, and financial state is always re-read at the provider.
  const {data:events,error:inboxError}=await supabaseAdmin.from('checkout_gateway_event').select('event_id,payment_id,event_type').is('processed_at',null).lte('next_attempt_at',new Date().toISOString()).order('next_attempt_at',{ascending:true}).limit(5);
  if(inboxError)throw inboxError;
  for(const event of events||[]) {
    if(Date.now()-started>120_000)break;
    try {
      const payment=await getAsaasPayment(event.payment_id);
      const id=Number(payment.externalReference);
      if(Number.isSafeInteger(id)&&id>0) {
        await reconcileCheckout(id,payment,event.event_type);
        const {error:processedError}=await supabaseAdmin.from('checkout_gateway_event').update({processed_at:new Date().toISOString()}).eq('event_id',event.event_id);
        if(processedError)throw processedError;
      }
    } catch {
      const {error:retryError}=await supabaseAdmin.from('checkout_gateway_event').update({next_attempt_at:new Date(Date.now()+5*60_000).toISOString()}).eq('event_id',event.event_id);
      if(retryError)throw retryError;
    }
  }
  const {data,error}=await supabaseAdmin.from('checkout_attempt').select('order_id').or('phase.not.in.(CANCELLED,DONE),release_pending.eq.true').order('reconciled_at',{ascending:true}).limit(10);
  if(error)throw error;
  const results=[];
  for(const attempt of data||[]) {
    if(Date.now()-started>120_000)break;
    try {await reconcileCheckout(Number(attempt.order_id));results.push({orderId:attempt.order_id,ok:true});}
    catch(error) {
      results.push({orderId:attempt.order_id,ok:false});
      if(!(error instanceof ManualCheckoutReview))await attemptUpdate(Number(attempt.order_id),{last_error:'Conciliação pendente. Verifique a cobrança e a integração antes de liberar estoque.'});
    }
    await attemptUpdate(Number(attempt.order_id),{reconciled_at:new Date().toISOString()});
  }
  return results;
}
