import 'server-only';
import { asaasRequest } from '@/lib/asaas';
import type { CardFees } from '@/lib/checkout-policy';

export async function getCardFees():Promise<CardFees>{
 const data=await asaasRequest<{payment?:{creditCard?:Record<string,unknown>}}>('/myAccount/fees/');
 const card=data.payment?.creditCard;
 if(!card)throw Error('Taxas de cartão indisponíveis.');
 // Interpret provider dates in the account timezone; a date-only promotion
 // expires at the end of that day, never extend an expired discount.
 const expiration=String(card.discountExpiration||'');
 const end=expiration.length===10?`${expiration}T23:59:59-03:00`:expiration.replace(' ','T')+(expiration.includes('Z')||/[+-]\d\d:\d\d$/.test(expiration)?'':'-03:00');
 const promotional=Number.isFinite(Date.parse(end))&&Date.parse(end)>Date.now();
 function percentage(normal:string,discount:string){
  const value=promotional&&typeof card![discount]==='number'?card![discount]:card![normal];
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>=100)throw Error('Taxas de cartão inválidas.');
  return value;
 }
 const operationValue=card.operationValue;
 if(typeof operationValue!=='number'||!Number.isFinite(operationValue)||operationValue<0||operationValue>1000)throw Error('Taxa operacional inválida.');
 return {operationValue,one:percentage('oneInstallmentPercentage','discountOneInstallmentPercentage'),six:percentage('upToSixInstallmentsPercentage','discountUpToSixInstallmentsPercentage'),twelve:percentage('upToTwelveInstallmentsPercentage','discountUpToTwelveInstallmentsPercentage')};
}
