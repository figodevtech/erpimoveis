// src/app/(app)/(pages)/(financeiro)/dre/dre-client.tsx
"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Info, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { endOfMonth, startOfMonth } from "date-fns";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LinhaDre, PeriodoDre, RespostaDre } from "./types";

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (v: number) => MOEDA.format(Number.isFinite(v) ? v : 0);
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);

function paraInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mesCorrente(): PeriodoDre {
  const hoje = new Date();
  return { de: paraInput(startOfMonth(hoje)), ate: paraInput(endOfMonth(hoje)) };
}

/** Cards do topo. Margens só existem se houver receita líquida. */
function montarIndicadores(ind: Record<string, number>) {
  const receitaLiquida = ind["3"] ?? 0;
  const margem = (v: number) => (receitaLiquida === 0 ? null : (v / receitaLiquida) * 100);

  return [
    { chave: "rl", rotulo: "Receita líquida", valor: ind["3"] ?? 0, extra: null as number | null },
    { chave: "lb", rotulo: "Lucro bruto", valor: ind["5"] ?? 0, extra: margem(ind["5"] ?? 0) },
    { chave: "ebitda", rotulo: "EBITDA", valor: ind["7"] ?? 0, extra: margem(ind["7"] ?? 0) },
    { chave: "rl2", rotulo: "Resultado líquido", valor: ind["14"] ?? 0, extra: margem(ind["14"] ?? 0) },
  ];
}

function Tendencia({ linha }: { linha: LinhaDre }) {
  if (linha.valorAnterior === 0 && linha.valor === 0) return <span className="text-muted-foreground">—</span>;

  const subiu = linha.variacao > 0;
  const igual = linha.variacao === 0;
  const Icone = igual ? Minus : subiu ? TrendingUp : TrendingDown;

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
}: {
  linha: LinhaDre;
  expandidas: ReadonlySet<number>;
  alternar: (id: number) => void;
  onAbrirDetalhe: (linha: LinhaDre) => void;
}) {
  const temFilhos = linha.filhos.length > 0;
  const aberta = expandidas.has(linha.id);
  const destaque = linha.tipo === "FORMULA" || linha.nivel === 1;
  const negativo = linha.valor < 0;

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
            <span className={cn("truncate", destaque && "uppercase")}>{linha.nome}</span>
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
                "w-full px-2 py-2 text-right tabular-nums underline-offset-4 hover:underline",
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
          <LinhaTabela key={filho.id} linha={filho} expandidas={expandidas} alternar={alternar} onAbrirDetalhe={onAbrirDetalhe} />
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
  const [detalhe, setDetalhe] = useState<LinhaDre | null>(null);

  const chave = `${periodo.de}|${periodo.ate}`;
  const [carregado, setCarregado] = useState("");
  const carregando = carregado !== chave;

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
        setExpandidas(new Set(resposta.linhas.filter((l) => l.filhos.length).map((l) => l.id)));
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setErro(e instanceof Error ? e.message : "Falha ao carregar a DRE.");
        setCarregado(chave);
      });

    return () => controller.abort();
  }, [chave, periodo.ate, periodo.de]);

  const alternar = useCallback((id: number) => {
    setExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }, []);

  const alertas = dados?.alertas;
  const pendencias = dados?.pendencias;
  const temAlerta =
    !!alertas &&
    (alertas.semDespesaOperacional === true ||
      (alertas.itensSemCusto ?? 0) > 0 ||
      (alertas.lancamentosSemClassificacao ?? 0) > 0 ||
      (alertas.gruposSemDestino ?? 0) > 0 ||
      alertas.filaIndisponivel);

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
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            Preliminar
          </Badge>
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

        {temAlerta && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          >
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              Este resultado está incompleto
            </p>
            <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-muted-foreground">
              {alertas?.filaIndisponivel && (
                <li>
                  Não foi possível apurar as pendências deste período. O relatório pode estar incompleto sem que
                  este aviso saiba dizer quanto.
                </li>
              )}
              {alertas?.semDespesaOperacional === true && (
                <li>Nenhuma despesa operacional foi lançada no período — o lucro aparece maior do que é.</li>
              )}
              {alertas?.itensSemCusto === null && (
                <li>Não foi possível conferir itens vendidos sem custo cadastrado.</li>
              )}
              {(alertas?.itensSemCusto ?? 0) > 0 && (
                <li>{alertas?.itensSemCusto} item(ns) vendido(s) sem custo cadastrado — a margem está superestimada.</li>
              )}
              {(alertas?.lancamentosSemClassificacao ?? 0) > 0 && (
                <li>
                  {alertas?.lancamentosSemClassificacao} lançamento(s) sem classificação, somando{" "}
                  {brl(alertas?.valorSemClassificacao ?? 0)}, ficaram fora do relatório.
                </li>
              )}
              {(alertas?.gruposSemDestino ?? 0) > 0 && (
                <li>
                  {alertas?.gruposSemDestino} grupo(s) do plano de contas sem linha da DRE — o que for lançado neles
                  não aparece em nenhuma linha do relatório.
                </li>
              )}
            </ul>
            {pendencias && !pendencias.indisponivel && pendencias.porMotivo.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Pendência</th>
                      <th className="py-1 pr-3 text-right font-medium">Itens</th>
                      <th className="py-1 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendencias.porMotivo.map((linha) => (
                      <tr key={linha.motivo} className="border-t border-amber-500/20">
                        <td className="py-1 pr-3">{linha.descricao}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{linha.quantidade}</td>
                        <td className="py-1 text-right tabular-nums">
                          {linha.valor === null ? "—" : brl(linha.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

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
                    onAbrirDetalhe={setDetalhe}
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

        <DetalheLinha linha={detalhe} periodo={periodo} onFechar={() => setDetalhe(null)} />
      </div>
    </MotionConfig>
  );
}

type LancamentoDre = {
  id: number;
  competenciaEm: string | null;
  origem: string | null;
  descricao: string;
  detalhe: string | null;
  valor: number;
  sourceType: string | null;
  sourceId: number | null;
  ordemServicoId: number | null;
  transacaoId: number | null;
  isManual: boolean;
  isEstorno: boolean;
  semCusto: boolean;
};

/** Lançamentos que compõem a linha. O total precisa bater com o da DRE. */
function DetalheLinha({
  linha,
  periodo,
  onFechar,
}: {
  linha: LinhaDre | null;
  periodo: PeriodoDre;
  onFechar: () => void;
}) {
  // Mesmo padrão do resto do projeto: o estado carrega a chave da consulta que o
  // produziu, então "carregando" é derivado e não precisa de setState no efeito.
  const chave = linha ? `${linha.id}|${periodo.de}|${periodo.ate}` : "";
  const [resultado, setResultado] = useState<{
    chave: string;
    items: LancamentoDre[];
    total: number;
  }>({ chave: "", items: [], total: 0 });

  const carregando = !!linha && resultado.chave !== chave;
  const items = carregando ? null : resultado.items;
  const total = carregando ? 0 : resultado.total;

  useEffect(() => {
    if (!linha) return;

    const controller = new AbortController();

    fetch(`/api/dre/drilldown?linha=${linha.id}&de=${periodo.de}&ate=${periodo.ate}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((corpo: { items?: LancamentoDre[]; total?: number }) => {
        if (controller.signal.aborted) return;
        setResultado({ chave, items: corpo.items ?? [], total: corpo.total ?? 0 });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResultado({ chave, items: [], total: 0 });
      });

    return () => controller.abort();
  }, [chave, linha, periodo.ate, periodo.de]);

  const confere = !!linha && !carregando && Math.abs(total - linha.valor) < 0.01;

  return (
    <Dialog open={!!linha} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {linha?.codigo} {linha?.nome}
          </DialogTitle>
          <DialogDescription>
            {periodo.de} a {periodo.ate} · {items?.length ?? 0} lançamento(s)
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Competência</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-32">Origem</TableHead>
                <TableHead className="w-32 text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                    {linha?.tipo === "FORMULA"
                      ? "Linha calculada a partir de outras — não possui lançamentos próprios."
                      : "Nenhum lançamento no período."}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {item.competenciaEm ? new Date(item.competenciaEm).toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell className="max-w-[22rem]">
                      <span className="block truncate">{item.descricao}</span>
                      {item.detalhe && (
                        <span className="block truncate text-xs text-muted-foreground">{item.detalhe}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.ordemServicoId
                        ? `OS #${item.ordemServicoId}`
                        : item.sourceType === "VENDA"
                          ? `Venda #${item.sourceId}`
                          : item.transacaoId
                            ? `Transação #${item.transacaoId}`
                            : (item.sourceType ?? "—")}
                      {item.isManual && " · manual"}
                      {item.isEstorno && " · estorno"}
                      {item.semCusto && " · sem custo"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{brl(item.valor)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">
            {confere ? "Confere com o total da linha" : "Total diferente do exibido na DRE"}
          </span>
          <span className={cn("font-semibold tabular-nums", !confere && "text-destructive")}>{brl(total)}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
