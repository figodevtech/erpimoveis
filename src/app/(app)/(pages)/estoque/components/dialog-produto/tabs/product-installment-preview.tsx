"use client";
import { useEffect,useRef,useState } from 'react';
import { Calculator,Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover,PopoverContent,PopoverTrigger } from '@/components/ui/popover';
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from '@/components/ui/table';
import { installmentQuote,type CardFees,type CheckoutPolicy } from '@/lib/integrations/site-checkout-policy';

const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function ProductInstallmentPreview({productId,price,policy,disabled,reference=false}:{productId:number;reference?:boolean;price:number;policy:CheckoutPolicy;disabled:boolean}){
 const [open,setOpen]=useState(false),[fees,setFees]=useState<CardFees|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[loading,setLoading]=useState(false);
 const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const keepOpen=()=>{if(closeTimer.current)clearTimeout(closeTimer.current);};
 const closeSoon=()=>{keepOpen();closeTimer.current=setTimeout(()=>setOpen(false),180);};
 useEffect(()=>()=>{if(closeTimer.current)clearTimeout(closeTimer.current);},[]);
 const needsFees=policy.feeMode!=='absorbed';
 useEffect(()=>{
  if(!open||!needsFees||fees||!(price>0))return;
  const controller=new AbortController();
  void fetch(`/api/integracoes/site/checkout-fees${productId?`?productId=${productId}`:''}`,{cache:'no-store',signal:controller.signal})
   .then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.message);return body.fees as CardFees;})
   .then(value=>{if(!controller.signal.aborted)setFees(value);})
   .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Não foi possível consultar as taxas.');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[open,needsFees,fees,productId,price,retry]);
 function changeOpen(value:boolean){keepOpen();setOpen(value);if(value&&needsFees&&!fees){setError('');setLoading(true);}}
 const canShow=price>0&&(!needsFees||Boolean(fees));
 return <Popover open={open} onOpenChange={changeOpen}>
  <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled} onPointerEnter={event=>{if(event.pointerType==='mouse')changeOpen(true);}} onPointerLeave={closeSoon}><Calculator className="size-4"/>Simular parcelas</Button></PopoverTrigger>
  <PopoverContent align="start" sideOffset={8} className="w-[min(32rem,calc(100vw-2rem))] overflow-hidden p-0" onPointerEnter={keepOpen} onPointerLeave={closeSoon} onFocusCapture={keepOpen} onOpenAutoFocus={event=>event.preventDefault()}>
   <div className="space-y-1 border-b p-4"><h4 className="text-sm font-semibold">Simulação do parcelamento</h4><p className="text-xs text-muted-foreground">{reference?'Valor de referência: ':'Preço informado no site: '}<strong className="text-foreground">{money(price)}</strong></p></div>
   {!(price>0)?<p className="p-4 text-sm text-muted-foreground">Informe um preço de venda no site para simular.</p>:canShow?<div className="max-h-[min(24rem,var(--radix-popover-content-available-height))] overflow-y-auto"><Table><TableHeader><TableRow><TableHead>Parcelas</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Acréscimo</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{Array.from({length:policy.maxInstallments},(_,i)=>i+1).map(count=>{
    try{const quote=installmentQuote(price,count,policy,fees);return <TableRow key={count}><TableCell className="font-medium">{count}x</TableCell><TableCell className="text-right tabular-nums"><span className="whitespace-nowrap">{money(quote.installment)}</span>{quote.lastInstallment!==quote.installment&&<span className="block whitespace-nowrap text-[10px] text-muted-foreground">Última: {money(quote.lastInstallment)}</span>}</TableCell><TableCell className="text-right tabular-nums"><span className="whitespace-nowrap">{money(quote.interest)}</span><span className="block text-[10px] text-muted-foreground">{(quote.interest/price*100).toLocaleString('pt-BR',{maximumFractionDigits:2})}%</span></TableCell><TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{money(quote.total)}</TableCell></TableRow>;}catch{return <TableRow key={count}><TableCell>{count}x</TableCell><TableCell colSpan={3} className="text-right text-xs text-muted-foreground">Indisponível para este valor</TableCell></TableRow>;}
   })}</TableBody></Table></div>:<div className="space-y-3 p-4" role="status">{loading?<p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Consultando taxas Asaas…</p>:<><p className="text-sm text-muted-foreground">{error||'Taxas indisponíveis para simulação.'}</p><Button type="button" variant="outline" size="sm" onClick={()=>{setError('');setLoading(true);setRetry(n=>n+1);}}>Tentar novamente</Button></>}</div>}
   <p className="border-t p-4 text-xs leading-relaxed text-muted-foreground">Prévia das regras atuais, inclusive alterações ainda não salvas. Uma unidade, sem frete. Salve as regras para aplicar à loja. Antecipação e comissão não entram no acréscimo.</p>
  </PopoverContent>
 </Popover>;
}
