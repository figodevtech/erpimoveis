"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAppResume } from "@/lib/app-resume";

import { listarQuadro, listarSetoresAtivos, QuadItem, SetorItem } from "../lib/api";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import OsTile from "./os-tile";
import EmptyColumn from "./emply-column";

import { Loader2, RefreshCcw, Building2, Clock, Filter, Layers, AlertCircle } from "lucide-react";

/* ---------------- utils ---------------- */

function normStatus(s?: string | null) {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "_")
    .toUpperCase();
}

const IS_ORCAMENTO = (s?: string | null) => {
  const ns = normStatus(s);
  return ns === "ORCAMENTO" || ns === "ORCAMENTO_RECUSADO" || ns === "APROVACAO_ORCAMENTO" || ns === "ORCAMENTO_APROVADO";
};

// ordenação consistente (mais antiga primeiro), priorizando execução salva
function sortMaisAntigaPrimeiro(items: QuadItem[]) {
  const time = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0);

  const pickIso = (os: QuadItem) => os.execucaoInicioEm || os.dataEntrada || os.dataSaida || null;

  return [...items].sort((a, b) => {
    const ta = time(pickIso(a));
    const tb = time(pickIso(b));
    if (ta !== tb) return ta - tb;
    return (a?.id ?? 0) - (b?.id ?? 0);
  });
}

/* --------------- campainha --------------- */
const useDoorbellChime = () => {
  return useCallback(async () => {
    try {
      const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;

      const ctx = new Ctx();
      try {
        await ctx.resume();
      } catch {}

      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);

      const delay = ctx.createDelay(1.5);
      delay.delayTime.value = 0.22;

      const fb = ctx.createGain();
      fb.gain.value = 0.23;

      const wet = ctx.createGain();
      wet.gain.value = 0.16;

      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(master);

      const dryBus = ctx.createGain();
      dryBus.gain.value = 1.0;
      dryBus.connect(master);

      function bell(t0: number, freq: number, dur: number, peak: number, downGlide = 0.9, partial2 = 0.35) {
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        g.connect(dryBus);
        g.connect(delay);

        const o1 = ctx.createOscillator();
        o1.type = "sine";
        o1.frequency.setValueAtTime(freq, t0);

        const o2 = ctx.createOscillator();
        o2.type = "triangle";
        o2.frequency.setValueAtTime(freq * 2, t0);

        const p2 = ctx.createGain();
        p2.gain.value = partial2;

        o1.connect(g);
        o2.connect(p2);
        p2.connect(g);

        g.gain.exponentialRampToValueAtTime(peak, t0 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

        o1.frequency.exponentialRampToValueAtTime(freq * downGlide, t0 + dur * 0.8);
        o2.frequency.exponentialRampToValueAtTime(freq * 2 * downGlide, t0 + dur * 0.8);

        o1.start(t0);
        o2.start(t0);
        o1.stop(t0 + dur + 0.05);
        o2.stop(t0 + dur + 0.05);
      }

      const now = ctx.currentTime + 0.02;
      bell(now, 1560, 0.55, 0.55, 0.92, 0.28);
      bell(now + 0.28, 880, 1.15, 0.6, 0.88, 0.32);

      setTimeout(() => {
        try {
          ctx.close();
        } catch {}
      }, 2000);
    } catch {}
  }, []);
};

const LS_SETOR_KEY = "acompanhamento:setor";

/* ---------------- Coluna estável (IMPORTANTE) ---------------- */

const BoardColumn = React.memo(function BoardColumn({
  title,
  items,
  emptyLabel,
  hint,
  now,
  initialLoading,
  boardHeightClass,
}: {
  title: string;
  items: QuadItem[];
  emptyLabel: string;
  hint?: string;
  now?: number;
  initialLoading: boolean;
  boardHeightClass: string;
}) {
  return (
    <Card className={`flex ${boardHeightClass} flex-col overflow-hidden border-border/70 bg-card/95 backdrop-blur gap-0`}>
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
          {hint ? <p className="truncate text-[11px] text-muted-foreground/80">{hint}</p> : null}
        </div>

        <Badge variant="outline" className="text-[10px]">
          {items.length}
        </Badge>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2 no-scroll-anchor">
        {initialLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[108px] w-full rounded-lg" />)
        ) : items.length ? (
          items.map((os) => <OsTile key={os.id} os={os} now={now} />)
        ) : (
          <EmptyColumn label={emptyLabel} />
        )}
      </div>
    </Card>
  );
});

/* ---------------- main ---------------- */

export default function PainelAcompanhamento({
  finalizadas = "recentes",
  horasRecentes = 12,
}: {
  finalizadas?: "hoje" | "recentes";
  horasRecentes?: number;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [rawAguardando, setRawAguardando] = useState<QuadItem[]>([]);
  const [execucao, setExecucao] = useState<QuadItem[]>([]);
  const [faturamento, setFaturamento] = useState<QuadItem[]>([]);

  const [finalizadasRecentesList, setFinalizadasRecentesList] = useState<QuadItem[]>([]);

  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const [setores, setSetores] = useState<SetorItem[]>([]);
  const [setorSelecionado, setSetorSelecionado] = useState<string | null>(null); // "all" | "<id>"

  // contador (tick 1s) — agora também em "all"
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const prevSigRef = useRef("__init__");
  const firstLoadRef = useRef(true);
  const inFlightRef = useRef(false);

  const doorbell = useDoorbellChime();

  const makeSignature = useCallback((data: {
    aguardando: QuadItem[];
    emAndamento: QuadItem[];
    aguardandoPagamento: QuadItem[];
    concluidasRecentes: QuadItem[];
  }) => {
    const tiny = (arr: QuadItem[]) => JSON.stringify({ n: arr.length, ids: arr.map((x) => x.id).slice(0, 30) });
    return [
      tiny(data.aguardando),
      tiny(data.emAndamento),
      tiny(data.aguardandoPagamento),
      tiny(data.concluidasRecentes),
    ].join("|");
  }, []);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(LS_SETOR_KEY);
      if (v) setSetorSelecionado(v);
    } catch {}
  }, []);

  const carregarSetores = useCallback(async () => {
    try {
      const items = await listarSetoresAtivos();
      setSetores(items);
    } catch {
      setSetores([]);
    }
  }, []);

  useEffect(() => {
    void carregarSetores();
  }, [carregarSetores]);

  const load = useCallback(async () => {
    if (!setorSelecionado) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setRefreshing(true);
    setErr(null);

    try {
      const setorId = setorSelecionado === "all" ? undefined : Number(setorSelecionado);

      const quadro = await listarQuadro({ finalizadas, horasRecentes, setorId });

      const sig = makeSignature({
        aguardando: quadro.aguardando,
        emAndamento: quadro.emAndamento,
        aguardandoPagamento: quadro.aguardandoPagamento,
        concluidasRecentes: quadro.concluidasRecentes,
      });

      const prev = prevSigRef.current;
      prevSigRef.current = sig;

      setRawAguardando(sortMaisAntigaPrimeiro(quadro.aguardando));
      setExecucao(sortMaisAntigaPrimeiro(quadro.emAndamento));
      setFaturamento(sortMaisAntigaPrimeiro(quadro.aguardandoPagamento));

      setFinalizadasRecentesList(sortMaisAntigaPrimeiro(quadro.concluidasRecentes));
      setLastUpdated(Date.now());

      if (!firstLoadRef.current && prev !== sig) {
        void doorbell();
      }
      firstLoadRef.current = false;
    } catch (e: any) {
      setErr(e?.message || "Falha ao carregar painel");
    } finally {
      inFlightRef.current = false;
      setRefreshing(false);
      setInitialLoading(false);
    }
  }, [setorSelecionado, finalizadas, horasRecentes, makeSignature, doorbell]);

  useEffect(() => {
    if (!setorSelecionado) return;
    void load();
  }, [setorSelecionado, finalizadas, horasRecentes, load]);

  // tick 1s para contador
  useEffect(() => {
    if (!setorSelecionado) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [setorSelecionado]);

  // Painel de TV: rele a cada 15 s enquanto visivel e na volta para a aba. A
  // reconciliacao de 60 s que tambem rodava aqui era redundante com este ciclo.
  useEffect(() => {
    if (!setorSelecionado) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    const pararDeOuvir = onAppResume(() => void load());
    return () => {
      clearInterval(id);
      pararDeOuvir();
    };
  }, [setorSelecionado, load]);

  const textoSetor = useMemo(() => {
    if (!setorSelecionado) return "Selecione um setor";
    if (setorSelecionado === "all") return "Visão geral";
    return setores.find((s) => String(s.id) === setorSelecionado)?.nome ?? "Setor";
  }, [setorSelecionado, setores]);

  const precisaSelecionar = !setorSelecionado;
  const modoGeral = setorSelecionado === "all";

  function confirmarSetor(v: string) {
    setSetorSelecionado(v);
    setInitialLoading(true);
    try {
      window.localStorage.setItem(LS_SETOR_KEY, v);
    } catch {}
  }

  // Altura dos quadros para ocupar melhor a tela
  const boardHeightClass = "h-[calc(100vh-130px)] md:h-[calc(100vh-140px)] lg:h-[calc(100vh-150px)]";

  return (
    <div className="relative w-full">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">Acompanhamento de OS</h1>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="gap-1">
              <Filter className="h-3.5 w-3.5" />
              {textoSetor}
            </Badge>

            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3.5 w-3.5" />
              {lastUpdated ? new Date(lastUpdated).toLocaleString() : "—"}
            </Badge>

            {refreshing ? (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Atualizando…
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />

            <Select value={setorSelecionado ?? ""} onValueChange={(v) => confirmarSetor(v)}>
              <SelectTrigger className="h-9 w-[260px] text-xs">
                <SelectValue placeholder="Selecione um setor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="inline-flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Visão geral
                  </span>
                </SelectItem>

                {setores.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Voltar ao sistema */}
          <Button asChild variant="outline" className="h-9">
            <Link href="/">Sair</Link>
          </Button>

          {/* Atualizar */}
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => void load()}
            disabled={!setorSelecionado || refreshing}
            aria-label="Atualizar"
          >
            <RefreshCcw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>

      {/* Erro */}
      {err ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
          <div>
            <p className="font-medium">Falha ao carregar painel</p>
            <p className="text-xs text-destructive/80">{err}</p>
          </div>
        </div>
      ) : null}

      {/* Overlay obrigatório */}
      {precisaSelecionar ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md border-border/70 bg-card p-4">
            <div className="space-y-1">
              <p className="text-base font-semibold">Selecione o setor</p>
              <p className="text-xs text-muted-foreground">Escolha um setor ativo ou selecione “Visão geral”.</p>
            </div>

            <div className="mt-4 space-y-3">
              <Select value="" onValueChange={(v) => confirmarSetor(v)}>
                <SelectTrigger className="h-10 w-full text-sm">
                  <SelectValue placeholder="Escolha um setor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Visão geral</SelectItem>
                  {setores.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <p className="text-[11px] text-muted-foreground">O setor escolhido fica salvo neste navegador.</p>
            </div>
          </Card>
        </div>
      ) : null}

      {/* Conteúdo */}
      {!precisaSelecionar ? (
        modoGeral ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 ">
            <BoardColumn
              title="Aguardando"
              hint={rawAguardando.some((x) => IS_ORCAMENTO(x.status)) ? "Contém itens em orçamento" : undefined}
              items={rawAguardando}
              emptyLabel="Nenhuma OS aguardando."
              initialLoading={initialLoading}
              boardHeightClass={boardHeightClass}
            />

            <BoardColumn
              title="Em execução"
              items={execucao}
              now={nowTick}
              emptyLabel="Nenhuma OS em execução."
              initialLoading={initialLoading}
              boardHeightClass={boardHeightClass}
            />

            <BoardColumn
              title="Aguardando pagamento"
              items={faturamento}
              emptyLabel="Nenhuma OS aguardando pagamento."
              initialLoading={initialLoading}
              boardHeightClass={boardHeightClass}
            />

            <BoardColumn
              title="Finalizadas"
              items={finalizadasRecentesList}
              emptyLabel="Nenhuma OS finalizada recentemente."
              initialLoading={initialLoading}
              boardHeightClass={boardHeightClass}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr] px-0">
            {/* Em andamento (maior) */}
            <Card className={`flex ${boardHeightClass} flex-col overflow-hidden border-border/70 bg-card/95 gap-2`}>
              <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Em andamento • {textoSetor}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground/80">
                    Contador (desde a entrada) + itens do orçamento
                  </p>
                </div>

                <Badge variant="outline" className="text-[10px]">
                  {execucao.length}
                </Badge>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-2 no-scroll-anchor">
                {initialLoading ? (
                  Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[98px] w-full rounded-lg" />)
                ) : execucao.length ? (
                  execucao.map((os) => <OsTile key={os.id} os={os} now={nowTick} compact />)
                ) : (
                  <EmptyColumn label="Nenhuma OS em andamento neste setor." />
                )}
              </div>
            </Card>

            {/* Finalizadas (menor) */}
            <Card className={`flex ${boardHeightClass} flex-col overflow-hidden border-border/70 bg-card/95 gap-2`}>
              <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Finalizadas • {textoSetor}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground/80">Concluídas ou canceladas</p>
                </div>

                <Badge variant="outline" className="text-[10px]">
                  {finalizadasRecentesList.length}
                </Badge>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-2 no-scroll-anchor">
                {initialLoading ? (
                  Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[98px] w-full rounded-lg" />)
                ) : finalizadasRecentesList.length ? (
                  finalizadasRecentesList.map((os) => <OsTile key={os.id} os={os} compact />)
                ) : (
                  <EmptyColumn label="Nenhuma OS finalizada neste setor." />
                )}
              </div>
            </Card>
          </div>
        )
      ) : (
        <div className={boardHeightClass} />
      )}
    </div>
  );
}
