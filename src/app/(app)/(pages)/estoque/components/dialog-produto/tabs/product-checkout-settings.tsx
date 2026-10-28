"use client";
import { useEffect,useState } from 'react';
import { CreditCard,Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ValueInput } from '@/components/ui/value-input';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { defaultCheckoutPolicy,checkoutPolicySchema,type CheckoutPolicy } from '@/lib/integrations/site-checkout-policy';
import { paymentFields } from '@/lib/integrations/site-checkout-inheritance';
import { ProductInstallmentPreview } from './product-installment-preview';

function ShippingWeightInput({value,onChange,disabled}:{value:number;onChange:(value:number)=>void;disabled:boolean}){
 const [draft,setDraft]=useState<string|null>(null);
 const displayed=value.toLocaleString('pt-BR',{useGrouping:false,minimumFractionDigits:3,maximumFractionDigits:3});
 return <div className="space-y-2 min-w-0"><Label htmlFor="site-package-weight">Peso (kg)</Label><Input id="site-package-weight" type="text" inputMode="decimal" autoComplete="off" placeholder="0,000" disabled={disabled} value={draft??(value?displayed:'')} onBlur={()=>setDraft(null)} onChange={event=>{const text=event.target.value;if(!/^\d*(?:[,.]\d{0,3})?$/.test(text))return;const weight=Number(text.replace(',','.'));if(!Number.isFinite(weight)||weight>1000)return;setDraft(text);onChange(weight);}}/></div>;
}

export function ProductCheckoutSettings({productId=0,groupId,assignedGroupId,price=0}:{productId?:number;groupId?:number;assignedGroupId?:number;price?:number}){
 const isGroup=Boolean(groupId),targetId=groupId||productId;
 const query=isGroup?`groupId=${groupId}`:`productId=${productId}${assignedGroupId!==undefined?`&previewGroupId=${assignedGroupId||0}`:''}`;
 const [paymentOverride,setPaymentOverride]=useState(false),[groupName,setGroupName]=useState<string|null>(null),[referencePrice,setReferencePrice]=useState(100);
 const [inheritedPolicy,setInheritedPolicy]=useState<CheckoutPolicy>(defaultCheckoutPolicy);
 const [busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[reload,setReload]=useState(0);
 const [policy,setPolicy]=useState<CheckoutPolicy>(defaultCheckoutPolicy);
 const [loadError,setLoadError]=useState(false);
 const field=(key:keyof CheckoutPolicy,value:number)=>setPolicy(p=>({...p,[key]:value}));
 useEffect(()=>{
 if(!targetId)return;
 const controller=new AbortController();
 void fetch(`/api/integracoes/site/checkout-config?${query}`,{cache:'no-store',signal:controller.signal})
 .then(async response=>{const body=await response.json();if(!response.ok)throw Error();return {...body,policy:checkoutPolicySchema.parse(body.policy)};})
 .then(value=>{if(!controller.signal.aborted){setPolicy({...value.policy,freeShipping:isGroup?value.policy.freeShipping:value.freeShippingOverride??null});setPaymentOverride(value.paymentOverride===true);setInheritedPolicy(checkoutPolicySchema.parse(value.inheritedPolicy||defaultCheckoutPolicy));setGroupName(value.groupName||null);setLoaded(true);}})
 .catch(()=>{if(!controller.signal.aborted)setLoadError(true);});
 return()=>controller.abort();
 },[targetId,query,reload,isGroup]);
 async function save(){
 const result=checkoutPolicySchema.safeParse(policy);if(!result.success){toast.error(result.error.issues[0]?.message);return;}
 setBusy(true);try{const r=await fetch(`/api/integracoes/site/checkout-config?${query}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(isGroup?{groupId,policy:result.data}:{productId,policy:result.data,paymentOverride})});const body=await r.json();if(!r.ok)throw Error(body.message);toast.success('Regras do site atualizadas.');}catch{toast.error('Não foi possível salvar as regras.');}finally{setBusy(false);}
 }
 return <section className="min-w-0 space-y-4 rounded-lg border bg-card p-4" aria-label={isGroup?'Pagamento deste grupo':'Pagamento deste produto'}>
 <div className="flex items-center gap-3 border-b pb-3"><div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><CreditCard className="size-4 text-muted-foreground"/></div><div className="min-w-0"><h3 className="text-sm font-semibold">Pagamento no site</h3><p className="text-xs text-muted-foreground">{isGroup?'Aplicado aos produtos do grupo que não possuem regra individual.':'Use a regra do grupo ou personalize somente este produto.'}</p></div></div>
 {!targetId&&<p className="text-xs text-muted-foreground">Salve o produto para configurar o parcelamento.</p>}
 {Boolean(targetId)&&!loaded&&<div role="status" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{loadError?'Não foi possível carregar as regras deste produto.':'Carregando as regras do produto...'}</span>{loadError&&<Button type="button" variant="ghost" size="sm" onClick={()=>{setLoadError(false);setReload(value=>value+1);}}>Tentar novamente</Button>}</div>}
 {!isGroup&&loaded&&<div className="space-y-2 rounded-lg border bg-muted/20 p-3"><div className="flex items-center justify-between gap-3"><Label htmlFor="site-payment-override">Personalizar parcelamento deste produto</Label><Switch id="site-payment-override" checked={paymentOverride} disabled={busy} onCheckedChange={value=>{setPaymentOverride(value);if(!value)setPolicy(p=>({...p,...paymentFields(inheritedPolicy)}));}}/></div><p className="text-xs text-muted-foreground">{paymentOverride?'A regra individual tem prioridade sobre o grupo.':groupName?`Usando as regras do grupo ${groupName}. Sem configuração no grupo, o padrão é à vista.`:'Sem grupo configurado: pagamento à vista, com taxas absorvidas pela loja.'}</p></div>}
 <fieldset disabled={busy||!loaded||(!isGroup&&!paymentOverride)} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
 <legend className="sr-only">Cartão de crédito</legend>
 <div className="min-w-0 space-y-2"><Label htmlFor="site-installments">Máximo de parcelas</Label><Select disabled={busy||!loaded||(!isGroup&&!paymentOverride)} value={String(policy.maxInstallments)} onValueChange={value=>setPolicy(p=>({...p,maxInstallments:Number(value),interestFreeInstallments:Math.min(Number(value),p.interestFreeInstallments)}))}><SelectTrigger id="site-installments" className="w-full bg-background"><SelectValue/></SelectTrigger><SelectContent>{Array.from({length:12},(_,i)=>i+1).map(n=><SelectItem key={n} value={String(n)}>{n===1?'Somente à vista':`Até ${n} parcelas`}</SelectItem>)}</SelectContent></Select></div>
 <div className="min-w-0 space-y-2"><Label htmlFor="site-minimum">Valor mínimo por parcela (R$)</Label><ValueInput id="site-minimum" decimals={2} allowNegative={false} value={policy.minimumInstallment} onValueChange={value=>field('minimumInstallment',value)} className="bg-background text-right tabular-nums"/></div>
 <div className="min-w-0 space-y-2"><Label htmlFor="site-free-installments">Parcelas sem acréscimo (diferença)</Label><Select disabled={busy||!loaded||(!isGroup&&!paymentOverride)} value={String(policy.interestFreeInstallments)} onValueChange={v=>field('interestFreeInstallments',Number(v))}><SelectTrigger id="site-free-installments" className="w-full bg-background"><SelectValue/></SelectTrigger><SelectContent>{Array.from({length:policy.maxInstallments},(_,i)=>i+1).map(n=><SelectItem key={n} value={String(n)}>{n}x</SelectItem>)}</SelectContent></Select></div>
 <div className="min-w-0 space-y-2"><Label htmlFor="site-fee-mode">Repasse das taxas Asaas</Label><Select disabled={busy||!loaded||(!isGroup&&!paymentOverride)} value={policy.feeMode} onValueChange={value=>setPolicy(p=>({...p,feeMode:value as CheckoutPolicy['feeMode'],monthlyInterestPercent:0}))}><SelectTrigger id="site-fee-mode" className="w-full bg-background"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="absorbed">Loja absorve as taxas</SelectItem><SelectItem value="incremental">Somente diferença do parcelamento</SelectItem><SelectItem value="full">Repassar toda a taxa do cartão</SelectItem></SelectContent></Select></div>
 </fieldset>
 {isGroup&&<div className="space-y-2"><Label htmlFor="group-preview-price">Valor de referência para simular (R$)</Label><ValueInput id="group-preview-price" value={referencePrice} decimals={2} allowNegative={false} onValueChange={setReferencePrice} className="bg-background text-right tabular-nums sm:max-w-56"/><p className="text-xs text-muted-foreground">Usado somente na simulação; não altera preços dos produtos.</p></div>}
 <ProductInstallmentPreview productId={productId} reference={isGroup} price={isGroup?referencePrice:price} policy={policy} disabled={busy||!loaded}/>
 <p className="text-xs leading-relaxed text-muted-foreground">As taxas vigentes são consultadas na conta Asaas da loja. O repasse integral inclui o crédito em 1x; na diferença do parcelamento, a loja absorve o custo à vista. O limite sem acréscimo vale para essa diferença. Antecipação e comissão da Central não entram no repasse.</p>
 <div className="space-y-2 border-t pt-4"><Label htmlFor="site-free-shipping">Frete no site</Label><Select disabled={busy||!loaded} value={policy.freeShipping===null&&!isGroup?'inherit':policy.freeShipping?'free':'paid'} onValueChange={value=>setPolicy(p=>({...p,freeShipping:value==='inherit'?null:value==='free'}))}><SelectTrigger id="site-free-shipping" className="w-full bg-background"><SelectValue/></SelectTrigger><SelectContent>{!isGroup&&<SelectItem value="inherit">Usar regra do grupo</SelectItem>}<SelectItem value="free">Frete grátis: loja paga e escolhe o envio</SelectItem><SelectItem value="paid">Cobrar frete do cliente</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{!isGroup&&policy.freeShipping===null?`Regra do grupo: ${inheritedPolicy.freeShipping?'frete grátis':'frete cobrado do cliente'}. `:''}A loja organiza e paga o envio dos itens com frete grátis. Itens sem gratuidade continuam com frete cobrado.</p></div>
 {!isGroup&&<fieldset disabled={busy||!loaded} className="space-y-3 border-t pt-4"><legend className="sr-only">Embalagem para envio</legend><h4 className="text-sm font-semibold">Peso e dimensões para envio</h4><p className="text-xs text-muted-foreground">Informe a embalagem de uma unidade. Essas medidas também preenchem os anúncios do Mercado Livre ao criar ou editar. O site calcula o carrinho completo pelo endereço do cliente, usando a origem de Configurações → Empresa.</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><ShippingWeightInput key={targetId} value={policy.shippingPackage?.weight||0} disabled={busy||!loaded} onChange={weight=>setPolicy(p=>({...p,shippingPackage:{width:0,height:0,length:0,...p.shippingPackage,weight}}))}/>{(['width','height','length'] as const).map(key=><div key={key} className="space-y-2 min-w-0"><Label htmlFor={`site-package-${key}`}>{{width:'Largura (cm)',height:'Altura (cm)',length:'Comprimento (cm)'}[key]}</Label><Input id={`site-package-${key}`} type="number" min="0.001" max="1000" step="0.001" inputMode="decimal" value={policy.shippingPackage?.[key]||''} onChange={e=>setPolicy(p=>({...p,shippingPackage:{weight:0,width:0,height:0,length:0,...p.shippingPackage,[key]:Number(e.target.value)}}))}/></div>)}</div></fieldset>}
 <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">{isGroup?'As regras são salvas separadamente dos demais dados do grupo.':'As regras são salvas separadamente dos demais dados do produto.'}</p><Button type="button" disabled={busy||!loaded} onClick={()=>void save()} className="shrink-0">{busy&&<Loader2 className="size-4 animate-spin"/>}{busy?'Salvando...':'Salvar regras'}</Button></div>
 </section>;
}
