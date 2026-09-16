// src/app/(app)/(pages)/(financeiro)/dre/dre-client.tsx
"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Info, Minus, Printer, TrendingDown, TrendingUp } from "lucide-react";
import { endOfMonth, startOfMonth } from "date-fns";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LinhaDre, PendenciaDre, PeriodoDre, RespostaDre } from "./types";
import { DetalheLinhaDialog } from "./components/detalhe-linha-dialog";
import { OrigensLinhaDialog } from "./components/origens-linha-dialog";
import { PendenciasDialog } from "./components/pendencias-dialog";
import { TarjaPendencias } from "./components/tarja-pendencias";
import { brl, direcaoDaVariacao, montarIndicadores, pct } from "./apresentacao";

function paraInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mesCorrente(): PeriodoDre {
  const hoje = new Date();
  return { de: paraInput(startOfMonth(hoje)), ate: paraInput(endOfMonth(hoje)) };
}

/** Procura a linha na árvore pelo id: depois de refazer a DRE, o objeto antigo tem o valor antigo. */
function acharLinha(linhas: LinhaDre[], id: number | null): LinhaDre | null {
  if (id === null) return null;
  for (const linha of linhas) {
    if (linha.id === id) return linha;
    const filho = acharLinha(linha.filhos, id);
    if (filho) return filho;
  }
  return null;
}

function Tendencia({ linha }: { linha: LinhaDre }) {
  const direcao = direcaoDaVariacao(linha);
  if (direcao === null) return <span className="text-muted-foreground">—</span>;

  const Icone = direcao === "IGUAL" ? Minus : direcao === "SUBIU" ? TrendingUp : TrendingDown;

  return (
    <span className="inline-flex items-center justify-end gap-1 tabular-nums">
      <Icone className="size-3.5 shrink-0" aria-hidden />
      <span>{pct(linha.variacaoPercentual)}</span>
    </span>
  );
}

function LinhaTabela({
  linha,
  expandidas,
  alternar,
  onAbrirDetalhe,
  onAbrirOrigens,
}: {
  linha: LinhaDre;
  expandidas: ReadonlySet<number>;
  alternar: (id: number) => void;
  onAbrirDetalhe: (linha: LinhaDre) => void;
  onAbrirOrigens: (linha: LinhaDre) => void;
}) {
  const temFilhos = linha.filhos.length > 0;
  const aberta = expandidas.has(linha.id);
  const destaque = linha.tipo === "FORMULA" || linha.nivel === 1;
  const negativo = linha.valor < 0;
  // Linha de fórmula não tem fonte própria: ela combina o resultado de outras.
  const temOrigens = linha.tipo !== "FORMULA";

  return (
    <Fragment>
      <TableRow className={cn(destaque && "bg-muted/40 font-medium")}>
        <TableCell style={{ paddingLeft: `${0.5 + (linha.nivel - 1) * 1.25}rem` }}>
          <div className="flex items-center gap-1.5">
            {temFilhos ? (
              <button
                type="button"
                onClick={() => alternar(linha.id)}
                aria-expanded={aberta}
                aria-label={`${aberta ? "Recolher" : "Expandir"} ${linha.nome}`}
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <motion.span animate={{ rotate: aberta ? 90 : 0 }} className="flex">
                  <ChevronRight className="size-4" aria-hidden />
                </motion.span>
              </button>
            ) : (
              <span className="size-5" aria-hidden />
            )}
            <span className="text-xs text-muted-foreground tabular-nums">{linha.codigo}</span>
            {temOrigens ? (
              <button
                type="button"
                onClick={() => onAbrirOrigens(linha)}
                title={`Ver o que entra em ${linha.nome}`}
                className={cn(
                  "-mx-1 cursor-pointer truncate rounded-sm px-1 underline-offset-4 transition-colors",
                  "hover:bg-accent hover:underline",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  destaque && "uppercase",
                )}
              >
                {linha.nome}
              </button>
            ) : (
              <span className={cn("truncate", destaque && "uppercase")}>{linha.nome}</span>
            )}
            {linha.semFonte && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="size-3.5 shrink-0 cursor-help text-amber-600 dark:text-amber-400" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Sem origem automática no sistema. Só recebe valor por lançamento manual.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </TableCell>

        <TableCell className="p-0 text-right">
          {linha.tipo === "FORMULA" || linha.lancamentos === 0 ? (
            <span className={cn("block px-2 py-2 tabular-nums", negativo && "text-destructive")}>
              {brl(linha.valor)}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onAbrirDetalhe(linha)}
              title={`Ver os ${linha.lancamentos} lançamentos de ${linha.nome}`}
              className={cn(
                "w-full cursor-pointer px-2 py-2 text-right tabular-nums underline-offset-4 transition-colors",
                "hover:bg-accent hover:underline",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                negativo && "text-destructive",
              )}
            >
              {brl(linha.valor)}
            </button>
          )}
        </TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">
          {brl(linha.valorAnterior)}
        </TableCell>
        <TableCell className="text-right text-muted-foreground">
          <Tendencia linha={linha} />
        </TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">
          {pct(linha.percentualReceitaLiquida)}
        </TableCell>
      </TableRow>

      <AnimatePresence initial={false}>
        {temFilhos && aberta && linha.filhos.map((filho) => (
          <LinhaTabela
            key={filho.id}
            linha={filho}
            expandidas={expandidas}
            alternar={alternar}
            onAbrirDetalhe={onAbrirDetalhe}
            onAbrirOrigens={onAbrirOrigens}
          />
        ))}
      </AnimatePresence>
    </Fragment>
  );
}

export function DreClient() {
  const padrao = useMemo(() => mesCorrente(), []);
  const [periodo, setPeriodo] = useState<PeriodoDre>(padrao);
  const [dados, setDados] = useState<RespostaDre | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [expandidas, setExpandidas] = useState<ReadonlySet<number>>(new Set());
  /*
   * Guarda o id, não a linha. Mover um plano de conta refaz a DRE; um objeto
   * guardado continuaria com o valor de antes, e a conferência do detalhamento
   * acusaria diferença que não existe.
   */
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [origensId, setOrigensId] = useState<number | null>(null);
  const [pendenciaAberta, setPendenciaAberta] = useState<PendenciaDre | null>(null);
  /*
   * Recarregamento silencioso. Depois de corrigir uma pendência o relatório
   * precisa ser refeito, mas sem voltar ao esqueleto: quem acabou de gravar está
   * olhando o número que quer ver mudar, e piscar a tela inteira esconde
   * justamente isso.
   */
  const [versao, setVersao] = useState(0);
  const refazer = useCallback(() => setVersao((n) => n + 1), []);

  const chave = `${periodo.de}|${periodo.ate}`;
  const [carregado, setCarregado] = useState("");
  const carregando = carregado !== chave;
  /** Período cujos grupos já foram abertos uma vez. */
  const expandidasDaChave = useRef("");

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/dre?de=${periodo.de}&ate=${periodo.ate}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const corpo = await r.json();
        if (!r.ok) throw new Error(corpo?.error || "Falha ao carregar a DRE.");
        return corpo as RespostaDre;
      })
      .then((resposta) => {
        if (controller.signal.aborted) return;
        setDados(resposta);
        setErro(null);
        setCarregado(chave);
        // Grupos de primeiro nível já abertos: a DRE é para ser lida, não caçada.
        // Só na primeira carga do período — na recarga silenciosa a pessoa pode ter
        // recolhido grupos, e reabrir tudo desfaria o que ela arrumou.
        if (expandidasDaChave.current !== chave) {
          expandidasDaChave.current = chave;
          setExpandidas(new Set(resposta.linhas.filter((l) => l.filhos.length).map((l) => l.id)));
        }
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setErro(e instanceof Error ? e.message : "Falha ao carregar a DRE.");
        setCarregado(chave);
      });

    return () => controller.abort();
  }, [chave, periodo.ate, periodo.de, versao]);

  const alternar = useCallback((id: number) => {
    setExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }, []);

  const detalhe = useMemo(() => (dados ? acharLinha(dados.linhas, detalheId) : null), [dados, detalheId]);
  const origens = useMemo(() => (dados ? acharLinha(dados.linhas, origensId) : null), [dados, origensId]);
  const abrirDetalhe = useCallback((linha: LinhaDre) => setDetalheId(linha.id), []);
  const abrirOrigens = useCallback((linha: LinhaDre) => setOrigensId(linha.id), []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Demonstração do Resultado</h1>
            <p className="text-sm text-muted-foreground">
              Regime de competência
              {dados && ` · ${dados.template.nome} v${dados.template.versao}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              Preliminar
            </Badge>
            {/* A folha relê a DRE do mesmo período, com a mesma apuração da tela. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={!periodo.de || !periodo.ate}
              onClick={() => {
                const consulta = new URLSearchParams({ de: periodo.de, ate: periodo.ate });
                window.open(`/print/relatorios/dre?${consulta.toString()}`, "_blank", "noopener,noreferrer");
              }}
            >
              <Printer className="size-4" aria-hidden />
              Imprimir DRE
            </Button>
          </div>
        </header>

        <section aria-label="Período" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="dre-de" className="text-xs text-muted-foreground">De</Label>
            <Input id="dre-de" type="date" className="h-9 w-[10.5rem]" value={periodo.de}
              onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dre-ate" className="text-xs text-muted-foreground">Até</Label>
            <Input id="dre-ate" type="date" className="h-9 w-[10.5rem]" value={periodo.ate}
              onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))} />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setPeriodo(mesCorrente())}>
            Mês corrente
          </Button>
          {dados && (
            <p className="ml-auto text-xs text-muted-foreground">
              Comparando com {dados.periodo.anterior.de} a {dados.periodo.anterior.ate}
            </p>
          )}
        </section>

        <TarjaPendencias alertas={dados?.alertas} pendencias={dados?.pendencias} onAbrir={setPendenciaAberta} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {dados
            ? montarIndicadores(dados.indicadores).map((card) => (
                <Card key={card.chave}>
                  <CardContent className="grid gap-1 p-4">
                    <span className="text-sm text-muted-foreground">{card.rotulo}</span>
                    <span className={cn("text-2xl font-semibold tabular-nums", card.valor < 0 && "text-destructive")}>
                      {brl(card.valor)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {card.extra === null ? "margem indisponível" : `margem ${pct(card.extra)}`}
                    </span>
                  </CardContent>
                </Card>
              ))
            : Array.from({ length: 4 }).map((_, indice) => (
                <Card key={indice}>
                  <CardContent className="grid gap-2 p-4">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-7 w-32" />
                    <Skeleton className="h-4 w-20" />
                  </CardContent>
                </Card>
              ))}
        </div>

        <div className={cn("overflow-hidden rounded-lg border bg-card", carregando && "opacity-60")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conta</TableHead>
                <TableHead className="w-40 text-right">Período</TableHead>
                <TableHead className="w-40 text-right">Anterior</TableHead>
                <TableHead className="w-28 text-right">Variação</TableHead>
                <TableHead className="w-24 text-right">% RL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {erro ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">{erro}</TableCell>
                </TableRow>
              ) : !dados ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                dados.linhas.map((linha) => (
                  <LinhaTabela
                    key={linha.id}
                    linha={linha}
                    expandidas={expandidas}
                    alternar={alternar}
                    onAbrirDetalhe={abrirDetalhe}
                    onAbrirOrigens={abrirOrigens}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {dados && (
          <p className="text-xs text-muted-foreground">
            Atualizado em {new Date(dados.atualizadoEm).toLocaleString("pt-BR")}
          </p>
        )}

        <OrigensLinhaDialog
          linha={origens}
          periodo={periodo}
          versao={versao}
          onFechar={() => setOrigensId(null)}
          onAlterado={refazer}
        />

        <DetalheLinhaDialog
          linha={detalhe}
          periodo={periodo}
          versao={versao}
          onFechar={() => setDetalheId(null)}
          onAlterado={refazer}
        />

        <PendenciasDialog
          pendencia={pendenciaAberta}
          periodo={periodo}
          onFechar={() => setPendenciaAberta(null)}
          onCorrigido={refazer}
        />
      </div>
    </MotionConfig>
  );
}
