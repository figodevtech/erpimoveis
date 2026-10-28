import 'server-only';
import { shippingAccessToken,ShippingAuthError } from '@/lib/melhor-envio-oauth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getCheckoutPolicy } from '@/lib/erp-checkout-policy';

export type ShippingOption={id:number;name:string;company:string;price:number;days:number};
export class ShippingQuoteError extends Error { constructor(message:string,public status=422){super(message);} }
export async function quoteShipping(cep:string,items:{productId:number;quantity:number}[]){
 let access;
 try{access=await shippingAccessToken();}catch(error){throw new ShippingQuoteError(error instanceof ShippingAuthError?error.message:'Não foi possível autorizar a consulta de frete.',503);}
 const {token,environment}=access;
 if(!/^\d{8}$/.test(cep)||!items.length||items.length>100||items.some(i=>!Number.isInteger(i.productId)||i.productId<=0||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>999))throw new ShippingQuoteError('Confira o CEP e os produtos para calcular o frete.');
 const quantities=new Map<number,number>();
 for(const item of items)quantities.set(item.productId,(quantities.get(item.productId)||0)+item.quantity);
 if([...quantities.values()].some(q=>q>999))throw new ShippingQuoteError('Quantidade acima do limite de cotação.');
 const ids=[...quantities.keys()];
 const [config,catalog]=await Promise.all([getCheckoutPolicy(ids),supabaseAdmin.from('produto').select('id,precovenda,visible,is_deleted').in('id',ids)]);
 if(!config.available||!config.originCep)throw new ShippingQuoteError('A loja precisa conferir o CEP em Configurações → Empresa antes de calcular o frete.',503);
 if(catalog.error)throw new ShippingQuoteError('Não foi possível consultar os produtos para envio.',503);
 const products=ids.map(id=>{
  const product=catalog.data?.find(p=>Number(p.id)===id),pack=config.policies[String(id)]?.shippingPackage;
  if(!product||product.visible===false||product.is_deleted||!(Number(product.precovenda)>0))throw new ShippingQuoteError('Um produto não está disponível para envio. Atualize seu carrinho.');
  if(!pack)throw new ShippingQuoteError(`O produto #${id} ainda precisa de peso e dimensões para cotação. Consulte a loja.`);
  return {id:String(id),...pack,insurance_value:Math.round(Number(product.precovenda)*100)/100,quantity:quantities.get(id)!};
 });
 const email=process.env.NEXT_PUBLIC_COMPANY_EMAIL?.trim();
 if(!email||!email.includes('@'))throw new ShippingQuoteError('A loja precisa conferir o e-mail de contato da integração de frete.',503);
 const base=environment==='production'?'https://melhorenvio.com.br':'https://sandbox.melhorenvio.com.br';
 let response:Response;
 try{response=await fetch(`${base}/api/v2/me/shipment/calculate`,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json','User-Agent':`StorefrontERP (${email})`},body:JSON.stringify({from:{postal_code:config.originCep},to:{postal_code:cep},products,services:'1,2',options:{receipt:false,own_hand:false}})});}catch{throw new ShippingQuoteError('Não foi possível consultar o frete agora. Tente novamente.',503);}
 if(!response.ok)throw new ShippingQuoteError('A cotação de frete está indisponível. Consulte a loja.',503);
 const data:unknown=await response.json();
 if(!Array.isArray(data))throw new ShippingQuoteError('O serviço de frete retornou uma resposta inválida.',503);
 const options:ShippingOption[]=[];
 for(const row of data){
  if(!row||row.error||![1,2].includes(Number(row.id)))continue;
  const price=Number(row.custom_price),days=Number(row.custom_delivery_time);
  if(!Number.isFinite(price)||price<0||price>100000||!Number.isInteger(days)||days<0||days>365)continue;
  options.push({id:Number(row.id),name:String(row.name).slice(0,80),company:String(row.company?.name||'Correios').slice(0,80),price:Math.round(price*100)/100,days});
 }
 if(!options.length)throw new ShippingQuoteError('Não há PAC ou SEDEX disponível para este carrinho e endereço. Consulte a loja.');
 return {options,quotedAt:new Date().toISOString(),environment};
}
