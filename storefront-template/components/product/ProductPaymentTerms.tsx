"use client";
import { useCheckoutTerms } from './CheckoutTerms';
import { Button } from '@/components/ui/button';
import { Popover,PopoverTrigger,PopoverContent } from '@/components/ui/popover';
import { Table,TableHeader,TableBody,TableHead,TableRow,TableCell } from '@/components/ui/table';

const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function ProductPaymentTerms({productId,price,quantity=1}:{productId:number;price:number;quantity?:number}){
 const terms=useCheckoutTerms(price>0?[{productId,total:price*quantity}]:[]);
 if(!(price>0))return null;
 if(!terms.loaded)return <p role="status" className="text-xs text-muted-foreground">Consultando condições de pagamento…</p>;
 const best=terms.options.at(-1);
 if(!terms.available||!best)return <div className="space-y-1"><p className="text-xs text-muted-foreground">Condições do cartão indisponíveis agora.</p><Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={terms.refresh}>Consultar novamente</Button></div>;
 return <div className="space-y-1 text-xs text-muted-foreground">
  {quantity>1&&<p>Condições para {quantity} unidades:</p>}
  <p>{best.count>1?'Até ':''}<strong className="text-foreground">{best.count}x de {money(best.installment)}</strong> no cartão {best.interest?'com acréscimo':'sem acréscimo'}.</p>
  <p>Total no cartão: <strong className="text-foreground">{money(best.total)}</strong>{best.interest?` · acréscimo de ${money(best.interest)}`:''}.</p>
  <Popover><PopoverTrigger asChild><Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs">Ver condições de parcelamento</Button></PopoverTrigger><PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] overflow-hidden p-0"><h3 className="border-b p-4 text-sm font-semibold">Parcelamento no cartão</h3><div className="max-h-72 overflow-y-auto"><Table><TableHeader><TableRow><TableHead>Parcelas</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Acréscimo</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{terms.options.map(option=><TableRow key={option.count}><TableCell>{option.count}x</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{money(option.installment)}{option.lastInstallment!==option.installment&&<span className="block text-[10px] text-muted-foreground">Última: {money(option.lastInstallment)}</span>}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{money(option.interest)}</TableCell><TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{money(option.total)}</TableCell></TableRow>)}</TableBody></Table></div><p className="border-t p-4 text-xs text-muted-foreground">Valores dos produtos, sem frete. As condições são conferidas novamente no checkout para o carrinho completo.</p></PopoverContent></Popover>
 </div>;
}
