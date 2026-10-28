"use client";
import { useEffect,useState } from 'react';
import { Truck,Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
type Status={configured:boolean;connected:boolean;environment:string|null;message:string;requiresReconnect?:boolean};
export function StorefrontShippingConnection(){
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[reload,setReload]=useState(0),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();void fetch('/api/integracoes/site/shipping',{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.message);return body as Status;}).then(value=>{if(!controller.signal.aborted){setStatus(value);setError('');}}).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Não foi possível consultar o frete.');});return()=>controller.abort();},[reload]);
 async function connect(){setBusy(true);try{const response=await fetch('/api/integracoes/site/shipping',{method:'POST'});const body=await response.json();if(!response.ok)throw Error(body.message);window.location.assign(body.url);}catch(reason){toast.error(reason instanceof Error?reason.message:'Não foi possível conectar.');setBusy(false);}}
 return <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 space-y-1"><h3 className="flex items-center gap-2 text-sm font-semibold"><Truck className="size-4"/>Frete · Melhor Envio{status?.connected&&<Badge variant="secondary">Conectado</Badge>}{status?.environment==='sandbox'&&<Badge variant="outline">Teste</Badge>}</h3><p role="status" className="text-xs text-muted-foreground">{error||status?.message||'Consultando conexão de frete…'}</p><p className="text-xs text-muted-foreground">Cotação PAC e SEDEX. Origem em Configurações → Empresa; peso e dimensões no produto.</p></div><div className="flex shrink-0 flex-wrap gap-2"><Button type="button" variant="ghost" size="sm" onClick={()=>setReload(n=>n+1)} disabled={busy}>Atualizar status</Button><Button type="button" variant="outline" size="sm" onClick={()=>void connect()} disabled={busy||!status?.configured}>{busy&&<Loader2 className="size-4 animate-spin"/>}{status?.connected||status?.requiresReconnect?'Reconectar':'Conectar Melhor Envio'}</Button></div></section>;
}
