"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {DatePicker} from '@/components/ui/date-picker';
import {AmountRangeFilter} from './amount-range-filter';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {EMPTY_SITE_ORDER_FILTERS,siteOrderFiltersError,type SiteOrderFilters} from '@/lib/integrations/site-order-filters';
const stages=[['all','Todos os pedidos'],['active','Não cancelados'],['awaiting-payment','Aguardando pagamento'],['payment-analysis','Pagamento em análise'],['payment-review','Pagamento em revisão'],['error','Erro de importação'],['refund-pending','Estorno pendente'],['refund-denied','Estorno recusado'],['return-pending','Devolução aguardada'],['return-received','Devolução recebida'],['dispute','Contestações'],['cancelled','Cancelados']];
export function StorefrontOrderFilters({open,onOpenChange,filters,stage,search,onApply}:{open:boolean;onOpenChange:(open:boolean)=>void;filters:SiteOrderFilters;stage:string;search:string;onApply:(filters:SiteOrderFilters,stage:string,search:string)=>void}){
 const [draft,setDraft]=useState(filters),[draftStage,setStage]=useState(stage),[draftSearch,setSearch]=useState(search);
 const error=siteOrderFiltersError(draft);
 function update(key:keyof SiteOrderFilters,value:string){setDraft(current=>({...current,[key]:value}));}
 function period(days:number|'month'){
  const end=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Fortaleza'}));
  const start=new Date(end);if(days==='month')start.setDate(1);else start.setDate(start.getDate()-days+1);
  const date=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  setDraft(current=>({...current,startDate:date(start),endDate:date(end)}));
 }
 function fieldSelect(key:'payment'|'delivery',label:string,options:string[][]){return <div className="space-y-2"><Label htmlFor={`site-order-${key}`}>{label}</Label><Select value={draft[key]} onValueChange={value=>update(key,value)}><SelectTrigger id={`site-order-${key}`} className="w-full"><SelectValue/></SelectTrigger><SelectContent>{options.map(([value,text])=><SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select></div>;}
 return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full sm:max-w-md"><SheetHeader><SheetTitle>Filtrar pedidos do Site</SheetTitle><SheetDescription>Combine os filtros e aplique para atualizar a lista.</SheetDescription></SheetHeader>
  <form className="flex min-h-0 flex-1 flex-col" onSubmit={event=>{event.preventDefault();if(!error){onApply(draft,draftStage,draftSearch);onOpenChange(false);}}}>
   <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
    <div className="space-y-2"><Label htmlFor="site-order-number">Número do pedido</Label><Input id="site-order-number" value={draftSearch} inputMode="numeric" placeholder="Número exato" onChange={e=>setSearch(e.target.value.replace(/\D/g,''))}/></div>
    <div className="space-y-2"><Label htmlFor="site-order-stage">Situação</Label><Select value={draftStage} onValueChange={setStage}><SelectTrigger id="site-order-stage" className="w-full"><SelectValue/></SelectTrigger><SelectContent>{stages.map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    <fieldset className="space-y-3 border-t pt-3"><legend className="text-sm font-medium">Data da compra</legend><div className="flex flex-wrap gap-2">{([[1,'Hoje'],[7,'7 dias'],[30,'30 dias'],['month','Este mês']] as const).map(([days,text])=><Button key={days} type="button" size="sm" variant="outline" onClick={()=>period(days)}>{text}</Button>)}</div><div className="grid grid-cols-2 gap-3">{([['startDate','De'],['endDate','Até']] as const).map(([key,label])=><div key={key} className="space-y-2"><Label htmlFor={`site-order-${key}`}>{label}</Label><DatePicker id={`site-order-${key}`} aria-label={label} value={draft[key]} onChange={value=>update(key,value)} placeholder={label} min={key==="endDate"?draft.startDate:undefined} max={key==="startDate"?draft.endDate:undefined}/></div>)}</div></fieldset>
    <AmountRangeFilter id="site-order-total" title="Valor total (R$)" minValue={draft.minTotal} maxValue={draft.maxTotal} onChange={(minTotal,maxTotal)=>setDraft(current=>({...current,minTotal,maxTotal}))}/>
    {fieldSelect('payment','Forma de pagamento',[['all','Todas'],['PIX','Pix'],['BOLETO','Boleto'],['CREDIT_CARD','Cartão de crédito']])}
    {fieldSelect('delivery','Recebimento',[['all','Todos'],['delivery','Entrega no endereço'],['pickup','Retirada na loja']])}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
   </div><div className="flex justify-between gap-2 border-t p-4"><Button type="button" variant="outline" onClick={()=>{onApply(EMPTY_SITE_ORDER_FILTERS,'all','');onOpenChange(false);}}>Limpar filtros</Button><Button type="submit" disabled={Boolean(error)}>Aplicar filtros</Button></div>
  </form>
 </SheetContent></Sheet>;
}
