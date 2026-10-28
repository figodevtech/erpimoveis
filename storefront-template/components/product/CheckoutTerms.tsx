"use client";
import { useEffect,useState } from 'react';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { defaultCheckoutPolicy,checkoutPolicySchema,installmentQuoteForItems,type CheckoutPolicy,type CardFees } from '@/lib/checkout-policy';
export function useCheckoutTerms(items:{productId:number;total:number}[],shipping=0){
 const [policies,setPolicies]=useState<Record<string,CheckoutPolicy>>({});
 const [fees,setFees]=useState<CardFees|null>(null);
 const [requestedCount,setCount]=useState(1),[saveCard,setSaveCard]=useState(false);
 const [retry,setRetry]=useState(0);
 const [status,setStatus]=useState({ids:'',ready:false,available:false});
 const ids=[...new Set(items.map(i=>i.productId))].sort((a,b)=>a-b).join(',');
 useEffect(()=>{const abort=new AbortController();if(ids)void fetch(`/api/checkout/options?ids=${ids}`,{cache:'no-store',signal:abort.signal}).then(r=>r.ok?r.json():null).then(data=>{if(abort.signal.aborted)return;const next:Record<string,CheckoutPolicy>={};for(const [id,raw] of Object.entries(data?.policies||{})){const parsed=checkoutPolicySchema.safeParse(raw);if(parsed.success)next[id]=parsed.data;}setPolicies(next);setFees(data?.fees||null);setStatus({ids,ready:true,available:data?.available===true});}).catch(()=>{if(!abort.signal.aborted)setStatus({ids,ready:true,available:false});});return()=>abort.abort();},[ids,retry]);
 const max=items.length?Math.min(...items.map(i=>(policies[String(i.productId)]||defaultCheckoutPolicy).maxInstallments)):1;
 const options=[];for(let n=1;n<=max;n++){try{options.push(installmentQuoteForItems(items,n,policies,fees,shipping));}catch{ /* Missing fees or minimum installment not met. */ }}
 const count=options.some(o=>o.count===requestedCount)?requestedCount:1;
 const quote=options.find(o=>o.count===count);
 return {count,setCount,saveCard,setSaveCard,options,quote,loaded:status.ids===ids&&status.ready,available:status.ids===ids&&status.available,refresh:()=>{setPolicies({});setFees(null);setStatus({ids:'',ready:false,available:false});setRetry(n=>n+1);}};
}
type Terms=ReturnType<typeof useCheckoutTerms>;
const money=(n:number)=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function CheckoutTerms({terms,newCard,disabled}:{terms:Terms;newCard:boolean;disabled:boolean}){
 return <div className="space-y-4">
 {!terms.options.length&&<p role="status" className="text-sm text-muted-foreground">Não foi possível atualizar as condições do cartão. Atualize a página ou escolha Pix.</p>}
 <div className="space-y-2"><Label htmlFor="checkout-installments">Parcelamento</Label><Select value={String(terms.count)} onValueChange={v=>terms.setCount(Number(v))} disabled={disabled||!terms.options.length}><SelectTrigger id="checkout-installments" className="w-full"><SelectValue placeholder="À vista"/></SelectTrigger><SelectContent>{terms.options.map(o=><SelectItem key={o.count} value={String(o.count)}>{o.count}x de {money(o.installment)} {o.interest?'com acréscimo':'sem juros'} · total {money(o.total)}</SelectItem>)}</SelectContent></Select>
 {terms.quote&&terms.quote.lastInstallment!==terms.quote.installment&&<p className="text-xs text-muted-foreground">Última parcela: {money(terms.quote.lastInstallment)}.</p>}
 {Boolean(terms.quote?.interest)&&<p className="text-xs text-muted-foreground">Acréscimo do cartão: {money(terms.quote!.interest)}. Total a pagar: {money(terms.quote!.total)}.</p>}
 </div>
 {newCard&&<div className="flex items-start gap-3 rounded-lg border p-3"><Switch id="checkout-save-card" checked={terms.saveCard} onCheckedChange={terms.setSaveCard} disabled={disabled}/><div className="space-y-1"><Label htmlFor="checkout-save-card">Salvar cartão para compras futuras</Label><p className="text-xs text-muted-foreground">Opcional. Guardamos somente a referência segura fornecida pelo Asaas e os últimos quatro dígitos. Nunca o código de segurança.</p></div></div>}
 </div>;
}
