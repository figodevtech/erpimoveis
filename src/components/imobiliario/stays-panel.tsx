"use client";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Building2, CheckCircle2, Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Field, RemoteState, requestJson, useModulePermission, useRemote } from "./shared";

type Listing = { id: string; code: string; title: string; status: string };
type State = { configured: boolean; webhookReady?: boolean; host?: string;
  mapping: { listing_id: string; listing_codigo: string; listing_titulo: string } | null;
  state?: { ultima_sincronizacao: string | null; ultimo_erro: string | null; eventos_ativos: number; conflitos: number } | null };

export function StaysPanel({ imovelId }: { imovelId: number }) {
  const { can } = useModulePermission();
  const endpoint = `/api/imoveis/${imovelId}/stays`;
  const remote = useRemote<State>(endpoint);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [listingId, setListingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const editable = can("imoveis:editar");
  const load = async () => {
    setBusy(true);
    try {
      const result = await requestJson(`${endpoint}?listar=true`);
      setListings(result.listings); toast.success("Anúncios consultados na Stays.");
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };
  const action = async (operation: "vincular" | "sincronizar" | "desvincular") => {
    setBusy(true);
    try {
      const result = await requestJson(endpoint, operation === "desvincular" ? { method: "DELETE" } : { method: "POST", body: JSON.stringify({ action: operation, listingId: listingId || undefined }) });
      toast.success(operation === "desvincular" ? "Vínculo removido do ERP." : `Disponibilidade importada: ${result.eventos} períodos.`);
      setListingId("");
    } catch (error) { toast.error((error as Error).message); }
    finally { remote.reload(); setBusy(false); setDisconnecting(false); }
  };
  const data = remote.data;
  return <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs">
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="size-5" /></span><div><h3 className="text-base font-semibold">Stays</h3><p className="mt-0.5 text-xs text-muted-foreground">Vincule o anúncio e importe a disponibilidade.</p></div></div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{data?.mapping ? <><CheckCircle2 className="size-3.5" />Anúncio vinculado</> : data?.configured ? "Conexão configurada" : "Conexão pendente"}</span>
      </div>
      {remote.error ? <RemoteState error={remote.error} retry={remote.reload} /> : null}
      {!data && !remote.error ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Verificando conexão…</p> : null}
      {data && !data.configured ? <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">O acesso à API Stays ainda precisa ser configurado no servidor. Depois, os anúncios dessa conta poderão ser carregados aqui.</p> : null}
      {data?.configured ? <>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><a href={data.host} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:underline">Abrir conta Stays<ArrowUpRight className="size-3.5" /></a><span>{data.webhookReady ? "Recebimento assinado de notificações configurado" : "Notificações pendentes de configuração"}</span></div>
        {data.mapping ? <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
          <div><p className="text-sm font-medium">{data.mapping.listing_titulo}</p><p className="mt-1 text-xs text-muted-foreground">Código Stays: {data.mapping.listing_codigo}</p></div>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={busy || !editable} onClick={() => action("sincronizar")}><RefreshCw className="size-4" />{busy ? "Aguarde…" : "Atualizar agora"}</Button><Button type="button" variant="ghost" size="sm" disabled={busy || !editable} onClick={() => setDisconnecting(true)}><Unplug className="size-4" />Desvincular</Button></div>
        </div> : <div className="space-y-3">
          <Button type="button" variant="outline" disabled={busy || !editable} onClick={load}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Carregar anúncios da Stays</Button>
          {listings ? <>
            <Field label="Anúncio correspondente a este imóvel"><select aria-label="Anúncio Stays" className="h-11 w-full rounded-xl border bg-background px-3 text-sm" value={listingId} disabled={busy || !editable} onChange={(event) => setListingId(event.target.value)}><option value="">Selecione o anúncio</option>{listings.filter((listing) => listing.status === "active").map((listing) => <option key={listing.id} value={listing.id}>{listing.code} · {listing.title}</option>)}</select></Field>
            <Button type="button" disabled={busy || !editable || !listingId} onClick={() => action("vincular")}><Link2 className="size-4" />Vincular e importar disponibilidade</Button>
            {!listings.some((listing) => listing.status === "active") ? <p className="text-xs text-muted-foreground">Nenhum anúncio ativo foi retornado pela conta Stays.</p> : null}
          </> : null}
        </div>}
        {data.state ? <div role="status" className="space-y-1 text-xs text-muted-foreground"><p>{data.state.ultima_sincronizacao ? `Última importação: ${new Date(data.state.ultima_sincronizacao).toLocaleString("pt-BR")} · ${data.state.eventos_ativos} períodos` : "Aguardando primeira importação"}</p>{data.state.ultimo_erro ? <p className="text-destructive">{data.state.ultimo_erro}</p> : null}{data.state.conflitos > 0 ? <p className="text-amber-700 dark:text-amber-300">Há {data.state.conflitos} conflito(s) de datas. Confira as ocupações no ERP.</p> : null}</div> : null}
      </> : null}
      <p className="border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">Etapa inicial: importação Stays → ERP e site. Reservas criadas no ERP/site ainda não são enviadas à Stays. A conexão atual do Airbnb e Booking permanece administrada na Stays.</p>
    </div>
    <AlertDialog open={disconnecting} onOpenChange={(open) => !busy && setDisconnecting(open)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Desvincular anúncio Stays?</AlertDialogTitle><AlertDialogDescription>Os bloqueios importados dessa conexão serão removidos do ERP e do site. Isso não desconecta Airbnb e Booking da Stays.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => action("desvincular")}>Desvincular</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
