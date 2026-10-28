import { checkoutPolicySchema,defaultCheckoutPolicy,type CheckoutPolicy } from './site-checkout-policy';

export function paymentFields(policy:CheckoutPolicy){
 return {maxInstallments:policy.maxInstallments,minimumInstallment:policy.minimumInstallment,interestFreeInstallments:policy.interestFreeInstallments,feeMode:policy.feeMode,monthlyInterestPercent:0};
}

type ProductRule={policy:unknown;payment_override:boolean;updated_at?:string};
type GroupRule={policy:unknown;updated_at?:string};
export function resolveCheckoutPolicy(individual:ProductRule|undefined,group:GroupRule|undefined){
 const productPolicy=checkoutPolicySchema.parse(individual?.policy||defaultCheckoutPolicy);
 // Package dimensions are product-specific; free shipping inherits independently.
 const inherited=checkoutPolicySchema.parse({...defaultCheckoutPolicy,...(group?.policy as object||{}),shippingPackage:null,shippingRates:[]});
 const paymentOverride=Boolean(individual?.payment_override);
 const paymentPolicy=paymentOverride?productPolicy:{...productPolicy,...paymentFields(inherited)};
 const policy={...paymentPolicy,freeShipping:productPolicy.freeShipping??inherited.freeShipping??false};
 return {policy,freeShippingOverride:productPolicy.freeShipping,inheritedPolicy:inherited,paymentOverride,source:paymentOverride?'product':group?'group':'default'};
}
