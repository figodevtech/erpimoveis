'use client';
import { siteStatusLabel } from '@/lib/integrations/site-status-labels';
import { useCallback,useEffect,useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';

type Attempt={order_id:number;phase:string;billing_type:string;created_at:string;last_error:string|null;release_pending:boolean;reservation:{state:string;items:Array<{productId:number;quantity:number}>}|null};
const labels:Record<string,string>={PREPARING:'Preparando pagamento',SENDING:'Consultando provedor',BOUND:'Aguardando pagamento',REVIEW:'Revisão necessária',CANCELLED:'Liberação pendente'};
export default function StorefrontCheckouts() {
 const [rows,setRows]=useState<Attempt[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const load=useCallback(async(signal?:AbortSignal)=>{
  try {
   const response=await fetch('/api/integracoes/site/checkouts',{cache:'no-store',signal});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||'Falha ao consultar reservas.');
   setRows(result.data||[]);setError(result.warning||'');
  }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Falha ao consultar reservas.');}
 },[]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
 async function reconcile() {
  setBusy(true);
  try {const response=await fetch('/api/integracoes/site/checkouts',{method:'POST'});if(!response.ok)throw new Error('Conciliação pendente. Tente novamente.');await load();}
  catch(e){setError(e instanceof Error?e.message:'Falha na conciliação.');}
  finally{setBusy(false);}
 }
 return <Card className="min-w-0">
  <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><CardTitle className="text-base">Reservas de compras em andamento</CardTitle><Button variant="outline" size="sm" disabled={busy} onClick={reconcile}>{busy?'Conciliando…':'Conciliar pagamentos'}</Button></CardHeader>
  <CardContent className="space-y-3">
   {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
   {!rows.length&&!error&&<p className="text-sm text-muted-foreground">Nenhuma compra com reserva pendente.</p>}
   {rows.map(row=><div key={row.order_id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm">
    <div className="min-w-0 space-y-1"><p className="font-medium">Checkout #{row.order_id} · {row.billing_type}</p><p className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString('pt-BR')} · {row.reservation?.state==='RESERVED'?'Estoque reservado':row.release_pending?'Aguardando liberação de estoque':'Preparando reserva'}</p>{row.last_error&&<p className="break-words text-xs text-destructive">{row.last_error}</p>}</div>
    <Badge variant={row.phase==='REVIEW'?'destructive':'secondary'}>{labels[row.phase]||siteStatusLabel(row.phase)}</Badge>
   </div>)}
   <p className="text-xs text-muted-foreground">A reserva começa ao finalizar a compra. Cobranças sem confirmação permanecem em revisão; o estoque só é liberado após conciliação segura.</p>
  </CardContent>
 </Card>;
}
