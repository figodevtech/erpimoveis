"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeTabelas } from "@/hooks/use-realtime-tabelas";

/** Módulo, não literal: um array novo a cada render reiniciaria a inscrição. */
const TABELAS_REALTIME = ["ordemservico", "transacao", "venda"];
import { AlertCircle, Building2, Clock3, Eye, EyeOff, Layers3, Loader2, RefreshCcw, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import CobrancaTile from "./cobranca-tile";
import ValorMascarado from "./valor-mascarado";
import {
  listarAcompanhamentoFinanceiro,
  listarSetoresFinanceiro,
  type CobrancaItem,
  type OrigemCobranca,
  type QuadroFinanceiro,
} from "../lib/api";

const real = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const STORAGE_SETOR = "acompanhamento-financeiro:setor";
const STORAGE_ORIGEM = "acompanhamento-financeiro:origem";
const STORAGE_OCULTAR_VALORES = "acompanhamento-financeiro:ocultarValores";

function useDoorbellChime() {
  return useCallback(async () => {
    try {
      const AudioContextClass: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const context = new AudioContextClass();
      try {
        await context.resume();
      } catch {}

      const master = context.createGain();
      master.gain.value = 0.9;
      master.connect(context.destination);

      const delay = context.createDelay(1.5);
      delay.delayTime.value = 0.22;
      const feedback = context.createGain();
      feedback.gain.value = 0.23;
      const wet = context.createGain();
      wet.gain.value = 0.16;
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(master);

      const dry = context.createGain();
      dry.gain.value = 1;
      dry.connect(master);

      function bell(start: number, frequency: number, duration: number, peak: number, glide: number, partial: number) {
        const gain = context.createGain();
        gain.gain.value = 0.0001;
        gain.connect(dry);
        gain.connect(delay);

        const primary = context.createOscillator();
        primary.type = "sine";
        primary.frequency.setValueAtTime(frequency, start);

        const secondary = context.createOscillator();
        secondary.type = "triangle";
        secondary.frequency.setValueAtTime(frequency * 2, start);
        const secondaryGain = context.createGain();
        secondaryGain.gain.value = partial;
        primary.connect(gain);
        secondary.connect(secondaryGain);
        secondaryGain.connect(gain);

        gain.gain.exponentialRampToValueAtTime(peak, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        primary.frequency.exponentialRampToValueAtTime(frequency * glide, start + duration * 0.8);
        secondary.frequency.exponentialRampToValueAtTime(frequency * 2 * glide, start + duration * 0.8);
        primary.start(start);
        secondary.start(start);
        primary.stop(start + duration + 0.05);
        secondary.stop(start + duration + 0.05);
      }

      const now = context.currentTime + 0.02;
      bell(now, 1560, 0.55, 0.55, 0.92, 0.28);
      bell(now + 0.28, 880, 1.15, 0.6, 0.88, 0.32);
      window.setTimeout(() => void context.close().catch(() => undefined), 2000);
    } catch {}
  }, []);
}

function Coluna({
  titulo,
  subtitulo,
  items,
  loading,
  vazio,
  situacao,
  ocultarValores,
}: {
  titulo: string;
  subtitulo: string;
  items: CobrancaItem[];
  loading: boolean;
  vazio: string;
  situacao: "AGUARDANDO" | "RECEBIDO";
  ocultarValores: boolean;
}) {
  const columnClass = {
    AGUARDANDO: "border-sky-500/20 bg-sky-500/[0.035]",
    RECEBIDO: "border-emerald-500/20 bg-emerald-500/[0.035]",
  }[situacao];
  const headerClass = {
    AGUARDANDO: "border-sky-500/20 bg-sky-500/10",
    RECEBIDO: "border-emerald-500/20 bg-emerald-500/10",
  }[situacao];
  const titleClass = {
    AGUARDANDO: "text-sky-700 dark:text-sky-300",
    RECEBIDO: "text-emerald-700 dark:text-emerald-300",
  }[situacao];

  return (
    <Card className={`flex h-[calc(100vh-224px)] min-h-[430px] flex-col gap-0 overflow-hidden border py-0 ${columnClass}`}>
      <div className={`flex items-center justify-between border-b px-4 py-3 ${headerClass}`}>
        <div className="min-w-0">
          <p className={`truncate text-sm font-extrabold uppercase tracking-wide ${titleClass}`}>{titulo}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">{subtitulo}</p>
        </div>
        <Badge variant="outline" className={`text-xs font-bold ${titleClass}`}>{items.length}</Badge>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {loading ? (
          Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-[174px] rounded-lg" />)
        ) : items.length ? (
          items.map((item) => (
            <CobrancaTile key={item.chave} item={item} situacao={situacao} ocultarValores={ocultarValores} />
          ))
        ) : (
          <div className="flex h-36 items-center justify-center rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {vazio}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function PainelFinanceiro() {
  const [setores, setSetores] = useState<Array<{ id: number; nome: string }>>([]);
  const [setor, setSetor] = useState("all");
  const [origem, setOrigem] = useState<OrigemCobranca | "TODAS">("TODAS");
  const [quadro, setQuadro] = useState<QuadroFinanceiro | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocultarValores, setOcultarValores] = useState(false);
  const inFlight = useRef(false);
  const doorbell = useDoorbellChime();

  useEffect(() => {
    try {
      setSetor(localStorage.getItem(STORAGE_SETOR) || "all");
      const origemSalva = localStorage.getItem(STORAGE_ORIGEM);
      if (origemSalva === "OS" || origemSalva === "VENDA" || origemSalva === "TODAS") setOrigem(origemSalva);
      setOcultarValores(localStorage.getItem(STORAGE_OCULTAR_VALORES) === "1");
    } catch {}
    listarSetoresFinanceiro().then(setSetores).catch(() => setSetores([]));
  }, []);

  function alternarOcultarValores() {
    setOcultarValores((atual) => {
      const proximo = !atual;
      try { localStorage.setItem(STORAGE_OCULTAR_VALORES, proximo ? "1" : "0"); } catch {}
      return proximo;
    });
  }

  const carregar = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    setErro(null);
    try {
      const data = await listarAcompanhamentoFinanceiro({
        setorId: setor === "all" ? undefined : Number(setor),
        origem,
        horasRecentes: 24,
      });
      setQuadro(data);
    } catch (error: any) {
      setErro(error?.message || "Falha ao carregar pagamentos");
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [origem, setor]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useRealtimeTabelas(TABELAS_REALTIME, () => {
    void doorbell();
    void carregar();
  });

  const nomeSetor = useMemo(
    () => setor === "all" ? "Todos os setores" : setores.find((item) => String(item.id) === setor)?.nome || "Setor",
    [setor, setores],
  );
  const cobrancasEmAberto = useMemo(
    () => [...(quadro?.aguardando ?? []), ...(quadro?.parciais ?? [])]
      .sort((a, b) => b.saldo - a.saldo),
    [quadro],
  );

  function trocarSetor(value: string) {
    setSetor(value);
    setLoading(true);
    try { localStorage.setItem(STORAGE_SETOR, value); } catch {}
  }

  function trocarOrigem(value: string) {
    const next = value as OrigemCobranca | "TODAS";
    setOrigem(next);
    setLoading(true);
    try { localStorage.setItem(STORAGE_ORIGEM, next); } catch {}
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1800px] px-3 py-4 sm:px-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Acompanhamento de pagamentos</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="gap-1"><Building2 className="h-3 w-3" />{nomeSetor}</Badge>
            <Badge variant="outline" className="gap-1"><Layers3 className="h-3 w-3" />{origem === "TODAS" ? "OS e vendas" : origem}</Badge>
            <Badge variant="secondary" className="gap-1">
              <Clock3 className="h-3 w-3" />
              {quadro?.meta.atualizadoEm ? new Date(quadro.meta.atualizadoEm).toLocaleString("pt-BR") : "—"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={setor} onValueChange={trocarSetor}>
            <SelectTrigger className="h-9 w-[210px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os setores</SelectItem>
              {setores.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={origem} onValueChange={trocarOrigem}>
            <SelectTrigger className="h-9 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="TODAS">OS e vendas</SelectItem>
              <SelectItem value="OS">Somente OS</SelectItem>
              <SelectItem value="VENDA">Somente vendas</SelectItem>
            </SelectContent>
          </Select>
          <Button asChild variant="outline" className="h-9"><Link href="/">Sair</Link></Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={alternarOcultarValores}
            title={ocultarValores ? "Mostrar valores" : "Ocultar valores"}
          >
            {ocultarValores ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => void carregar()} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {erro ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {erro}
        </div>
      ) : null}

      <section className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          {
            label: "Cobranças no painel",
            value: String(quadro?.resumo.quantidade ?? 0),
            accent: "text-violet-600 dark:text-violet-400",
            icon: "bg-violet-500/10",
          },
          {
            label: "Total em aberto",
            value: real.format(quadro?.resumo.aReceber ?? 0),
            accent: "text-amber-600 dark:text-amber-400",
            icon: "bg-amber-500/10",
          },
          {
            label: "Total recebido",
            value: real.format(quadro?.resumo.recebido ?? 0),
            accent: "text-emerald-600 dark:text-emerald-400",
            icon: "bg-emerald-500/10",
          },
          {
            label: "Volume financeiro",
            value: real.format(quadro?.resumo.total ?? 0),
            accent: "text-sky-600 dark:text-sky-400",
            icon: "bg-sky-500/10",
          },
        ].map((item) => (
          <Card
            key={item.label}
            className="gap-2 border-border/70 bg-card/80 p-3 shadow-sm"
          >
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${item.icon} ${item.accent}`}>
                <WalletCards className="h-4 w-4" />
              </span>
              {item.label}
            </div>
            <p className="text-lg font-bold tabular-nums text-foreground">
              {loading ? "—" : <ValorMascarado oculto={ocultarValores}>{item.value}</ValorMascarado>}
            </p>
          </Card>
        ))}
      </section>

      <main className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Coluna
          titulo="Aguardando pagamento"
          subtitulo="Todas as cobranças com saldo em aberto"
          items={cobrancasEmAberto}
          loading={loading}
          vazio="Nenhuma cobrança aguardando pagamento."
          situacao="AGUARDANDO"
          ocultarValores={ocultarValores}
        />
        <Coluna
          titulo="Recebidos"
          subtitulo="Quitados nas últimas 24 horas"
          items={quadro?.recebidos ?? []}
          loading={loading}
          vazio="Nenhum pagamento recebido recentemente."
          situacao="RECEBIDO"
          ocultarValores={ocultarValores}
        />
      </main>
    </div>
  );
}
