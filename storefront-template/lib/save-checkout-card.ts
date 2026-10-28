import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { CheckoutCard } from '@/lib/checkout-card';
import type { AsaasPayment } from '@/lib/asaas';
// Called only after payment binding, with explicit opt-in. Never store PAN or CVV.
export async function saveCheckoutCard(userId:string,customerId:number,providerCustomer:string,card:CheckoutCard,payment:AsaasPayment){
 const token=payment.creditCard?.creditCardToken;if(!token)return false;
 try{
 const {data:existing,error:readError}=await supabaseAdmin.from('customer_payment_card').select('id').eq('user_id',userId).eq('provider_customer_id',providerCustomer).eq('provider_card_token',token).maybeSingle();
 if(readError)throw readError;if(existing)return true;
 const {count,error:countError}=await supabaseAdmin.from('customer_payment_card').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('provider_customer_id',providerCustomer);if(countError)throw countError;
 const {error}=await supabaseAdmin.from('customer_payment_card').insert({cliente_id:customerId,user_id:userId,provider_customer_id:providerCustomer,provider_card_token:token,brand:payment.creditCard?.creditCardBrand||'CARTAO',last_four:card.number.slice(-4),holder_name:card.holderName,expiry_month:card.expiryMonth,expiry_year:card.expiryYear,is_default:!count});
 if(error)throw error;return true;
 }catch{return false;}
}
