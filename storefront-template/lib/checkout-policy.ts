import { z } from 'zod';

export const checkoutPolicySchema = z.object({
  maxInstallments: z.number().int().min(1).max(12),
  minimumInstallment: z.number().min(5).max(1000000),
  interestFreeInstallments: z.number().int().min(1).max(12),
  monthlyInterestPercent: z.number().min(0).max(30),
  feeMode: z.enum(['absorbed','incremental','full']).default('absorbed'),
  freeShipping: z.boolean().nullable().default(null),
  shippingPackage: z.object({weight:z.number().positive().max(1000),width:z.number().positive().max(1000),height:z.number().positive().max(1000),length:z.number().positive().max(1000)}).nullable().default(null),
  shippingRates: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    cepStart: z.string().regex(/^\d{8}$/),
    cepEnd: z.string().regex(/^\d{8}$/),
    price: z.number().min(0).max(100000),
    businessDays: z.number().int().min(1).max(90),
  }).refine(rate=>rate.cepStart<=rate.cepEnd,'Confira o intervalo de CEPs.')).max(30),
}).refine(policy=>policy.interestFreeInstallments<=policy.maxInstallments,'As parcelas sem juros não podem ultrapassar o limite.');

export type CheckoutPolicy = z.infer<typeof checkoutPolicySchema>;
export const defaultCheckoutPolicy: CheckoutPolicy = {maxInstallments:1,minimumInstallment:5,interestFreeInstallments:1,monthlyInterestPercent:0,shippingRates:[],feeMode:'absorbed',freeShipping:null,shippingPackage:null};

export type CardFees={operationValue:number;one:number;six:number;twelve:number};
const rate=(fees:CardFees,count:number)=>(count===1?fees.one:count<=6?fees.six:fees.twelve)/100;

// Account card fees, with explicit per-product pass-through policy.
// Integer cents are the authoritative amount; the last installment absorbs rounding.
export function installmentQuote(base:number,count:number,policy:CheckoutPolicy,fees?:CardFees|null){
  if(!Number.isFinite(base)||base<=0||!Number.isInteger(count)||count<1||count>policy.maxInstallments)throw Error('Quantidade de parcelas indisponível.');
  const baseCents=Math.round(base*100);
  const totalCents=quoteCents([{productId:1,total:base}],count,{'1':policy},fees);
  const installmentCents=Math.floor(totalCents/count);
  if(count>1&&installmentCents<Math.round(policy.minimumInstallment*100))throw Error('Valor mínimo por parcela não atendido.');
  return {count,total:totalCents/100,installment:installmentCents/100,lastInstallment:(totalCents-installmentCents*(count-1))/100,interest:(totalCents-baseCents)/100};
}

function quoteCents(items:{productId:number;total:number}[],count:number,policies:Record<string,CheckoutPolicy>,fees?:CardFees|null,shipping=0){
 if(!Number.isFinite(shipping)||shipping<0)throw Error('Frete inválido.');
 if(fees&&Object.values(fees).some(value=>!Number.isFinite(value)||value<0)||fees&&[fees.one,fees.six,fees.twelve].some(value=>value>=100))throw Error('Taxas inválidas.');
 const productsBase=items.reduce((sum,item)=>sum+Math.round(item.total*100),0);
 const base=productsBase+Math.round(shipping*100);
 let percent=0,fixed=0,baseline=0;
 for(const item of items){
  const policy=policies[String(item.productId)]||defaultCheckoutPolicy;
  if(!Number.isFinite(item.total)||item.total<=0||!Number.isInteger(count)||count<1||count>policy.maxInstallments)throw Error('Quantidade de parcelas indisponível.');
  const mode=policy.feeMode||'absorbed';
  if(mode==='absorbed'||(mode==='incremental'&&count<=policy.interestFreeInstallments))continue;
  if(!fees)throw Error('Não foi possível consultar as taxas do cartão. Tente novamente.');
  const cents=Math.round(item.total*100),share=cents/productsBase;
  percent+=share*rate(fees,count);
  // For a credit-card installment plan, the transaction fee applies to the
  // total sale, independent of the installment count. Never multiply it by n.
  // https://www.asaas.com/cobranca-cartao
  fixed+=share*fees.operationValue*100;
  if(mode==='incremental')baseline+=base*share*rate(fees,1)+share*fees.operationValue*100;
 }
 return Math.max(base,Math.ceil((base+fixed-baseline)/(1-percent)-1e-7));
}

export function installmentQuoteForItems(items:{productId:number;total:number}[],count:number,policies:Record<string,CheckoutPolicy>,fees?:CardFees|null,shipping=0){
 if(!items.length)throw Error('Carrinho vazio.');
 let totalCents=0,baseCents=0,minimum=0;
 for(const item of items){
 const policy=policies[String(item.productId)]||defaultCheckoutPolicy;
 baseCents+=Math.round(item.total*100);minimum=Math.max(minimum,policy.minimumInstallment);
 }
 baseCents+=Math.round(shipping*100);
 totalCents=quoteCents(items,count,policies,fees,shipping);
 const installmentCents=Math.floor(totalCents/count);
 if(count>1&&installmentCents<Math.round(minimum*100))throw Error('Valor mínimo por parcela não atendido.');
 return {count,total:totalCents/100,installment:installmentCents/100,lastInstallment:(totalCents-installmentCents*(count-1))/100,interest:(totalCents-baseCents)/100};
}
