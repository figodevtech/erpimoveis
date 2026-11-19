"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Check, CheckCircle2, CircleHelp, Clock3, Copy, Globe2, Link2, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, RemoteState, requestJson, useRemote, useModulePermission } from "./shared";
import type { Entity } from "./model";
import { StaysPanel } from "./stays-panel";

type Channel = "AIRBNB" | "BOOKING";
type CalendarLink = { id: number; canal: Channel; anuncio: string; responsavel: string; calendario_url: string; exportacao_confirmada: boolean; ultima_sincronizacao: string | null; ultimo_erro: string | null; eventos_ativos: number; conflitos: number };
type ChannelState = { items: CalendarLink[]; migrationPending: boolean };
const channels = [
  { id: "AIRBNB" as const, name: "Airbnb", href: "https://www.airbnb.com/hosting/calendar", help: "https://www.airbnb.com/help/article/99" },
  { id: "BOOKING" as const, name: "Booking", href: "https://admin.booking.com/", help: "https://partner.booking.com/en-us/help/rates-availability/extranet-calendar/syncing-your-bookingcom-calendar-third-party-calendars" },
];

function ChannelCalendar({ channel, saved, endpoint, editable, reload }: {
  channel: typeof channels[number]; saved?: CalendarLink; endpoint: string; editable: boolean; reload: () => void;
}) {
  const [url, setUrl] = useState(saved?.calendario_url ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const response = await requestJson(endpoint, { method: "POST", body: JSON.stringify({ canal: channel.id, calendario_url: url,
        anuncio: saved?.anuncio ?? "", responsavel: saved?.responsavel ?? "", exportacao_confirmada: saved?.exportacao_confirmada ?? false }) });
      if (response.sync?.status === "ERRO") toast.error("Link salvo, mas o calendário não pôde ser lido", { description: response.sync.erro });
      else toast.success("Calendário salvo e atualizado.");
      reload();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!saved) return;
    setBusy(true);
    try {
      await requestJson(endpoint, { method: "DELETE", body: JSON.stringify({ id: saved.id }) });
      toast.success("Calendário removido e bloqueios dessa origem liberados. Remova também o calendário importado na plataforma para desconectar os dois sentidos."); reload();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs">
    <div className={cn("h-1", channel.id === "AIRBNB" ? "bg-[#ff5a5f]" : "bg-[#003b95]")} />
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className={cn("grid size-11 shrink-0 place-items-center rounded-xl text-lg font-bold", channel.id === "AIRBNB" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-blue-600/10 text-blue-700 dark:text-blue-400")}>{channel.id === "AIRBNB" ? "A" : "B."}</span>
          <div><h4 className="text-base font-semibold tracking-tight">{channel.name}</h4><p className="mt-0.5 text-xs text-muted-foreground">Calendário do anúncio</p></div>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium", saved ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {saved ? <CheckCircle2 className="size-3.5" /> : <Link2 className="size-3.5" />}{saved ? "Link salvo" : "Não configurado"}
        </span>
      </div>
      <Button type="button" variant="outline" className="h-10 w-full justify-between rounded-xl bg-background text-xs sm:text-sm" asChild>
        <a href={channel.href} target="_blank" rel="noopener noreferrer">Pegar URL no {channel.name}<ArrowUpRight className="size-4 text-muted-foreground" /></a>
      </Button>
      <form onSubmit={save} className="flex flex-1 flex-col gap-4">
        <Field label={`URL do calendário ${channel.name}`}>
          <div className="relative"><Link2 aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
            <Input aria-label={`URL do calendário ${channel.name}`} type="url" required autoComplete="off" spellCheck={false}
              className="h-11 min-w-0 rounded-xl bg-background pl-9 text-xs" placeholder="https://… Cole o link iCal aqui" maxLength={2048} value={url} disabled={busy || !editable} onChange={(event) => setUrl(event.target.value)} />
          </div>
        </Field>
        <a className="inline-flex w-fit items-center gap-1.5 rounded text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={channel.help} target="_blank" rel="noopener noreferrer"><CircleHelp className="size-3.5" />Onde encontro o link?</a>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
          <Button type="submit" size="sm" className="h-9 rounded-lg px-4" disabled={busy || !editable || !url.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{busy ? "Aguarde…" : saved ? "Salvar alteração" : "Salvar link"}
          </Button>
          {saved ? <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-destructive" disabled={busy || !editable} onClick={remove}><Trash2 className="size-3.5" />Remover</Button> : null}
        </div>
      </form>
      {saved ? <div className="border-t border-border/60 pt-3 text-xs text-muted-foreground space-y-1" role="status">
        <p>{saved.ultima_sincronizacao ? `Última atualização: ${new Date(saved.ultima_sincronizacao).toLocaleString("pt-BR")} · ${saved.eventos_ativos} períodos` : "Aguardando primeira atualização"}</p>
        {saved.ultimo_erro ? <p className="text-destructive">{saved.ultimo_erro}</p> : null}
        {saved.conflitos > 0 ? <p className="text-amber-700 dark:text-amber-300">{saved.conflitos} conflito(s) de datas. Confira as reservas nas plataformas; os períodos continuam bloqueados.</p> : null}
      </div> : null}
    </div>
  </section>;
}

export function PropertyChannels({ item }: { item: Entity }) {
  const { can } = useModulePermission();
  const endpoint = `/api/imoveis/${item.id}/canais`;
  const remote = useRemote<ChannelState>(endpoint);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [destination, setDestination] = useState<Channel>("AIRBNB");
  const [syncing, setSyncing] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const exportPath = `/api/public/imoveis/${item.id}/calendario.ics?canal=${destination}`;
  const exportUrl = origin ? `${origin}${exportPath}` : "";
  const publicHost = origin.startsWith("https://") && !/^https:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
  const exportReady = publicHost && Boolean(item.ativo && item.publicado);
  const copyExport = async () => {
    try { await navigator.clipboard.writeText(exportUrl); setCopied(true); toast.success("URL do calendário do imóvel copiada."); }
    catch { toast.error("Não foi possível copiar a URL."); }
  };
  const synchronize = async () => {
    setSyncing(true);
    try {
      const response = await requestJson(`${endpoint}/sincronizar`, { method: "POST" });
      const failed = response.results.filter((result: { status: string }) => result.status === "ERRO").length;
      if (failed) toast.error("Uma das plataformas não pôde ser atualizada. Os bloqueios anteriores foram preservados.");
      else if (response.results.every((result: { status: string }) => result.status === "AGUARDANDO")) toast.info("Atualização já em andamento ou feita há menos de 30 segundos.");
      else toast.success("Disponibilidade atualizada no ERP e no site.");
      remote.reload();
    } catch (error) { toast.error((error as Error).message); }
    finally { setSyncing(false); }
  };
  return <div className="w-full min-w-0 space-y-6">
    <StaysPanel key={item.id} imovelId={Number(item.id)} />
    <details className="rounded-2xl border border-border/60 bg-card p-4">
      <summary className="cursor-pointer text-sm font-semibold">Calendários iCal · conexão alternativa</summary>
      <div className="mt-5 space-y-6">
    <div className="flex items-center gap-3 px-1"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">1</span><div><h4 className="text-sm font-semibold">Calendários das plataformas</h4><p className="mt-0.5 text-xs text-muted-foreground">Links dos anúncios vinculados a este imóvel.</p></div><ArrowDownLeft className="ml-auto size-4 text-muted-foreground" /></div>
    {remote.error ? <RemoteState error={remote.error} retry={remote.reload} /> : null}
    {!remote.data && !remote.error ? <div role="status" className="flex items-center justify-center gap-2 rounded-2xl border bg-card p-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Carregando calendários…</div> : null}
    {remote.data ? <div className="grid gap-4 lg:grid-cols-2">
      {channels.map((channel) => {
        const saved = remote.data?.items.find((link) => link.canal === channel.id);
        return <ChannelCalendar key={`${item.id}:${channel.id}:${saved?.calendario_url ?? ""}`} channel={channel} saved={saved}
          endpoint={endpoint} editable={can("imoveis:editar") && !remote.data?.migrationPending && !remote.loading} reload={remote.reload} />;
      })}
    </div> : null}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">As datas importadas atualizam a disponibilidade do ERP e do site.</p>
      <Button type="button" variant="outline" size="sm" disabled={syncing || !can("imoveis:editar") || !remote.data?.items.length} onClick={synchronize}><RefreshCw className={cn("size-4", syncing && "animate-spin")} />{syncing ? "Atualizando…" : "Atualizar agora"}</Button>
    </div>
    <div className="flex items-center gap-3 px-1"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">2</span><div><h4 className="text-sm font-semibold">Calendário para compartilhar</h4><p className="mt-0.5 text-xs text-muted-foreground">Escolha a plataforma onde vai importar o calendário.</p></div><ArrowUpRight className="ml-auto size-4 text-muted-foreground" /></div>
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs">
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-background text-primary"><Globe2 className="size-5" /></span><div><h4 className="text-sm font-semibold">URL do calendário do imóvel</h4><p className="mt-0.5 text-xs text-muted-foreground">Cespedes Living · formato iCal</p></div></div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <select aria-label="Plataforma de destino do calendário" value={destination} onChange={(event) => { setDestination(event.target.value as Channel); setCopied(false); }} className="h-11 rounded-xl border bg-background px-3 text-sm"><option value="AIRBNB">Para Airbnb</option><option value="BOOKING">Para Booking</option></select>
          <Input aria-label="URL do calendário deste imóvel" className="h-11 min-w-0 rounded-xl bg-background font-mono text-xs" value={exportUrl} readOnly onFocus={(event) => event.target.select()} />
          <Button type="button" className="h-11 rounded-xl px-5" onClick={copyExport} disabled={!exportReady}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "URL copiada" : "Copiar URL do imóvel"}</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{exportReady ? "Link disponível para importar nas plataformas." : "Requer ERP publicado em HTTPS e imóvel ativo e publicado."}</span>
          {exportReady ? <a className="inline-flex items-center gap-1 rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={exportPath} target="_blank" rel="noopener noreferrer">Abrir calendário<ArrowUpRight className="size-3.5" /></a> : null}
        </div>
        <div className="grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
          {channels.filter((channel) => channel.id === destination).map((channel) => (
            <div key={channel.id} className="space-y-2">
              <a className="inline-flex items-center gap-1.5 rounded text-xs font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={channel.href} target="_blank" rel="noopener noreferrer">
                Onde colar no {channel.name}<ArrowUpRight className="size-3.5" />
              </a>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {channel.id === "AIRBNB"
                  ? "No calendário do anúncio: Disponibilidade → Conectar calendários → Conectar a outro site. Cole esta URL no endereço do calendário e salve como Cespedes Living."
                  : "Na Extranet do anúncio, procure Sincronizar calendários em Tarifas e disponibilidade. Escolha adicionar/importar um calendário, cole esta URL e conclua a conexão como Cespedes Living."}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
    <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-amber-900 dark:text-amber-200">
      <Clock3 className="mt-0.5 size-4 shrink-0" /><div><p className="text-xs font-semibold">A atualização nas plataformas pode levar algumas horas</p><p className="mt-1 text-xs leading-relaxed opacity-80">“Atualizar agora” consulta os canais pelo ERP. Airbnb e Booking controlam quando leem o calendário do imóvel. Use a URL correspondente ao destino para evitar devolver eventos à própria origem.</p></div>
    </div>
      </div>
    </details>
  </div>;
}
