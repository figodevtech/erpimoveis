"use client";
import { useEffect,useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup,RadioGroupItem } from '@/components/ui/radio-group';
import type { ShippingOption } from '@/lib/shipping-quote';
type Item={productId:number;quantity:number};
type Result={options:ShippingOption[];quotedAt:string;environment:string|null;manual?:boolean};
export function useShippingQuote(cep:string,items:Item[],enabled=true){
 const key=JSON.stringify([cep.replace(/\D/g,''),items.map(i=>[i.productId,i.quantity]).sort((a,b)=>a[0]-b[0])]);
 const [state,setState]=useState<{key:string;result?:Result;error?:string}>({key:''});
 const [selected,setSelected]=useState<{key:string;id:number}|null>(null);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  const [digits,entries]=JSON.parse(key) as [string,number[][]];
  if(!enabled||digits.length!==8||!entries.length)return()=>controller.abort();
  const timer=setTimeout(()=>{
   void fetch('/api/shipping/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cep:digits,items:entries.map(([productId,quantity])=>({productId,quantity}))}),signal:controller.signal})
    .then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.message);return body as Result;})
    .then(result=>{if(!controller.signal.aborted)setState({key,result});})
    .catch(error=>{if(!controller.signal.aborted)setState({key,error:error instanceof Error?error.message:'Não foi possível consultar o frete.'});});
  },350);
  return()=>{clearTimeout(timer);controller.abort();};
 },[key,enabled,retry]);
 const current=state.key===key?state:undefined;
 const option=enabled&&selected?.key===key?current?.result?.options.find(o=>o.id===selected.id):undefined;
 return {result:current?.result,error:current?.error,busy:enabled&&cep.replace(/\D/g,'').length===8&&!current,option,select:(id:number)=>setSelected({key,id}),refresh:()=>{setSelected(null);setState({key:''});setRetry(n=>n+1);}};
}
export function ShippingChoices({quote,disabled=false}:{quote:ReturnType<typeof useShippingQuote>;disabled?:boolean}){
 return <div className="space-y-3">
 <div role="status" className="text-sm text-muted-foreground">{quote.busy?'Calculando frete…':quote.error}</div>
 {quote.result?.manual&&<p className="text-sm text-muted-foreground">Frete a combinar com a loja. O envio não está incluído no pagamento dos produtos; solicite uma cotação antes de comprar.</p>}
 {quote.error&&<Button type="button" variant="outline" size="sm" disabled={disabled} onClick={quote.refresh}>Tentar novamente</Button>}
 {quote.result&&<><RadioGroup aria-label="Serviço de entrega" disabled={disabled} value={quote.option?String(quote.option.id):''} onValueChange={id=>quote.select(Number(id))}>{quote.result.options.map(option=><Label key={option.id} htmlFor={`shipping-service-${option.id}`} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border p-3"><RadioGroupItem id={`shipping-service-${option.id}`} value={String(option.id)}/><span className="min-w-0 flex-1"><span className="block font-medium">{option.company} · {option.name}</span><span className="text-xs text-muted-foreground">Prazo estimado: {option.days} dias úteis após postagem</span></span><span className="shrink-0 tabular-nums">{option.price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span></Label>)}</RadioGroup>{quote.result.environment==='sandbox'&&<p className="text-xs text-muted-foreground">Cotação de teste, sem validade para postagem.</p>}</>}
 </div>;
}
export function ShippingSimulator({initialCep='',productIds,items}:{initialCep?:string;productIds:number[];items?:Item[]}){
 const [cep,setCep]=useState(initialCep),[destination,setDestination]=useState('');
 const quote=useShippingQuote(destination,items||productIds.map(productId=>({productId,quantity:1})));
 return <section className="space-y-3 rounded-xl border p-4"><h3 className="text-sm font-semibold">Simular custo de envio</h3><Label htmlFor="shipping-simulator-cep">CEP de destino</Label><div className="flex gap-2"><Input id="shipping-simulator-cep" inputMode="numeric" autoComplete="postal-code" maxLength={9} placeholder="00000-000" value={cep} onChange={e=>{setCep(e.target.value.replace(/[^\d-]/g,''));setDestination('');}}/><Button type="button" variant="outline" disabled={quote.busy||cep.replace(/\D/g,'').length!==8} onClick={()=>{setDestination(cep.replace(/\D/g,''));quote.refresh();}}>Simular</Button></div><ShippingChoices quote={quote}/><p className="text-xs text-muted-foreground">Cotação via Melhor Envio. O serviço e o valor final são conferidos no checkout para o carrinho e endereço selecionados. A etiqueta deve ser emitida pelo Melhor Envio para utilizar essa tarifa.</p></section>;
}
