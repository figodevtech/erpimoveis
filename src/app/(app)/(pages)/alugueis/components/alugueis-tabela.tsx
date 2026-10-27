"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  LayoutGrid,
  List,
  Loader,
  Loader2,
  Package,
  Plus,
  Search,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { ROTULO_TIPO_ITEM_ALUGUEL, type AbaAluguel } from "@/lib/alugueis/status";

import { listarAlugueis } from "../lib/api";
import type { AluguelLista } from "../types";
import { itensQueNaoVoltaram, nomeDoCliente } from "../types";
import { RowActions, type AcaoAluguel } from "./row-actions";
import { DestinatarioBadge, DiasAluguel, StatusAluguelBadge, fmtData, fmtLimite, fmtMoeda } from "./status-aluguel";

type Ordenacao = "id" | "inicio" | "limite" | "valor";
type Direcao = "asc" | "desc";

const CHAVE_VISAO = "alugueis_view_mode";

function lerVisao(): "grid" | "table" {
  try {
    return window.localStorage.getItem(CHAVE_VISAO) === "grid" ? "grid" : "table";
  } catch {
    return "table";
  }
}

function resumoItens(aluguel: AluguelLista) {
  const [primeiro, ...resto] = aluguel.itens;
  if (!primeiro) return "—";
  const texto = `${primeiro.quantidade > 1 ? `${primeiro.quantidade}× ` : ""}${primeiro.descricao}${primeiro.identificacao ? ` (${primeiro.identificacao})` : ""}`;
  return resto.length ? `${texto} +${resto.length}` : texto;
}

/** Encerrado com item que não voltou inteiro. */
function RetornoParcialBadge({ aluguel }: { aluguel: AluguelLista }) {
  if (aluguel.status !== "ENCERRADO") return null;
  const faltas = itensQueNaoVoltaram(aluguel.itens);
  if (!faltas.length) return null;
  return (
    <Badge
      variant="outline"
      className="border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-300"
      title={`Não retornou: ${faltas
        .map((item) => `${item.quantidade - (item.quantidade_devolvida ?? item.quantidade)}× ${item.descricao}`)
        .join(", ")}`}
    >
      Retorno parcial
    </Badge>
  );
}

function CabecalhoOrdenavel({
  rotulo,
  coluna,
  ordenacao,
  direcao,
  onChange,
}: {
  rotulo: string;
  coluna: Ordenacao;
  ordenacao: Ordenacao | null;
  direcao: Direcao;
  onChange: (coluna: Ordenacao | null, direcao: Direcao) => void;
}) {
  const ativo = ordenacao === coluna;
  return (
    <button
      type="button"
      className="inline-flex items-center hover:text-foreground"
      onClick={() => {
        // Mesmo ciclo da lista de OS: nenhum -> desc -> asc -> nenhum.
        if (!ativo) onChange(coluna, "desc");
        else if (direcao === "desc") onChange(coluna, "asc");
        else onChange(null, "desc");
      }}
    >
      {rotulo}
      {!ativo ? (
        <ChevronsUpDown className="ml-1 h-3.5 w-3.5 opacity-60" />
      ) : direcao === "asc" ? (
        <ChevronUp className="ml-1 h-3.5 w-3.5" />
      ) : (
        <ChevronDown className="ml-1 h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function AlugueisTabela({
  aba,
  onNovo,
  onAcao,
}: {
  aba: AbaAluguel;
  onNovo: () => void;
  onAcao: (acao: AcaoAluguel, aluguel: AluguelLista) => void;
}) {
  const { data: session } = useSession();
  const podeCriar = permissionSetHas((session?.user as any)?.permissoes, PERMS.ALUGUEIS_CRIAR);

  const [linhas, setLinhas] = useState<AluguelLista[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [ordenacao, setOrdenacao] = useState<Ordenacao | null>(null);
  const [direcao, setDirecao] = useState<Direcao>("desc");
  const [visao, setVisao] = useState<"grid" | "table">("table");
  const requisicao = useRef(0);

  useEffect(() => setVisao(lerVisao()), []);

  function alternarVisao(valor: "grid" | "table") {
    setVisao(valor);
    try {
      window.localStorage.setItem(CHAVE_VISAO, valor);
    } catch {
      // Preferência local; sem storage a tela segue em tabela.
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaAplicada(busca.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(async () => {
    const id = ++requisicao.current;
    setCarregando(true);
    try {
      const resposta = await listarAlugueis({
        aba,
        q: buscaAplicada || undefined,
        page,
        limit,
        sort: ordenacao ?? undefined,
        dir: ordenacao ? direcao : undefined,
      });
      if (id !== requisicao.current) return;
      setLinhas(resposta.items);
      setTotal(resposta.total);
      setTotalPages(resposta.totalPages);
    } catch (error: any) {
      if (id === requisicao.current) toast.error(error?.message || "Falha ao listar aluguéis.");
    } finally {
      if (id === requisicao.current) setCarregando(false);
    }
  }, [aba, buscaAplicada, page, limit, ordenacao, direcao]);

  useEffect(() => {
    const timer = window.setTimeout(() => void carregar(), 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  useEffect(() => {
    const aoMudar = () => void carregar();
    window.addEventListener("alugueis:refresh", aoMudar);
    return () => window.removeEventListener("alugueis:refresh", aoMudar);
  }, [carregar]);

  const inicio = total ? (page - 1) * limit + 1 : 0;
  const fim = Math.min(page * limit, total);

  const campoBusca = (
    <div className="relative w-full">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar... (#ID, cliente, usuário, item, placa)"
        className="pl-8 pr-9"
      />
      {busca ? (
        <button
          type="button"
          className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
          onClick={() => setBusca("")}
          aria-label="Limpar busca"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );

  return (
    <Card className="min-w-0 max-w-full overflow-hidden bg-card">
      <CardHeader className="min-w-0 border-b-2 pb-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle>Aluguéis</CardTitle>
            <CardDescription>
              <button
                onClick={() => void carregar()}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={carregando ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
            <div className="hidden w-[280px] md:block lg:w-[360px]">{campoBusca}</div>

            <div className="flex shrink-0 items-center rounded-xl border border-border bg-muted/30 p-0.5">
              <Button
                type="button"
                variant={visao === "grid" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => alternarVisao("grid")}
                className="h-8 w-8 rounded-lg hover:cursor-pointer"
                title="Visualização em Cards"
                aria-label="Visualização em Cards"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant={visao === "table" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => alternarVisao("table")}
                className="h-8 w-8 rounded-lg hover:cursor-pointer"
                title="Visualização em Tabela"
                aria-label="Visualização em Tabela"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>

            {podeCriar ? (
              <Button onClick={onNovo} size="sm" className="shrink-0 whitespace-nowrap hover:cursor-pointer">
                <Plus className="mr-1 h-4 w-4" />
                <span>Novo aluguel</span>
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-3 min-w-0 md:hidden">{campoBusca}</div>
      </CardHeader>

      <CardContent className="relative -mt-[24px] min-h-[300px] min-w-0 px-3 pb-4 pt-0 sm:px-4">
        <AnimatePresence mode="wait">
          {visao === "grid" ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-border/40 bg-muted/20 p-2 sm:p-3 md:grid-cols-2 xl:grid-cols-3"
            >
              {linhas.map((aluguel) => (
                <div
                  key={aluguel.id}
                  onDoubleClick={() => onAcao("detalhes", aluguel)}
                  className="flex h-full cursor-pointer select-none flex-col justify-between rounded-sm border border-slate-300 bg-card p-4 shadow-sm transition-colors hover:border-primary/60 hover:shadow-md dark:border-slate-700/80 sm:p-5"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant="outline" className="border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        #{aluguel.id}
                      </Badge>
                      <span className="flex flex-wrap justify-end gap-1">
                        <StatusAluguelBadge aluguel={aluguel} />
                        <RetornoParcialBadge aluguel={aluguel} />
                      </span>
                    </div>
                    <div>
                      <p className="truncate text-sm font-semibold" title={nomeDoCliente(aluguel)}>
                        {nomeDoCliente(aluguel)}
                        <DestinatarioBadge aluguel={aluguel} className="ml-2" />
                      </p>
                      <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground" title={aluguel.itens.map((i) => i.descricao).join(", ")}>
                        <Package className="h-3 w-3 shrink-0" />
                        {resumoItens(aluguel)}
                      </p>
                    </div>
                    <div className="text-sm">
                      <DiasAluguel aluguel={aluguel} />
                    </div>
                  </div>
                  <div className="mt-4 space-y-2 border-t border-slate-200/80 pt-3 dark:border-slate-800/80">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {fmtData(aluguel.data_inicio)} → <strong className="font-medium text-foreground">{fmtLimite(aluguel.data_limite)}</strong>
                      </span>
                      <span className="font-medium text-foreground">{fmtMoeda(aluguel.valor_total)}</span>
                    </div>
                    <div className="flex justify-end">
                      <RowActions aluguel={aluguel} onAcao={onAcao} />
                    </div>
                  </div>
                </div>
              ))}
              {!carregando && !linhas.length ? (
                <div className="col-span-full rounded-2xl border border-dashed bg-card p-6 py-12 text-center text-muted-foreground">
                  Nenhum aluguel encontrado.
                </div>
              ) : null}
            </motion.div>
          ) : (
            <motion.div
              key="table"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="mt-6 min-w-0 max-w-full overflow-hidden rounded-md border"
            >
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="min-w-[50px]">
                      <CabecalhoOrdenavel rotulo="#" coluna="id" ordenacao={ordenacao} direcao={direcao} onChange={(c, d) => { setOrdenacao(c); setDirecao(d); }} />
                    </TableHead>
                    <TableHead className="min-w-[200px]">Cliente</TableHead>
                    <TableHead className="min-w-[220px]">Itens</TableHead>
                    <TableHead className="min-w-[90px]">
                      <CabecalhoOrdenavel rotulo="Início" coluna="inicio" ordenacao={ordenacao} direcao={direcao} onChange={(c, d) => { setOrdenacao(c); setDirecao(d); }} />
                    </TableHead>
                    <TableHead className="min-w-[90px]">
                      <CabecalhoOrdenavel rotulo="Limite" coluna="limite" ordenacao={ordenacao} direcao={direcao} onChange={(c, d) => { setOrdenacao(c); setDirecao(d); }} />
                    </TableHead>
                    <TableHead className="min-w-[130px]">Dias</TableHead>
                    <TableHead className="min-w-[110px]">Status</TableHead>
                    <TableHead className="min-w-[100px] text-right">
                      <CabecalhoOrdenavel rotulo="Valor" coluna="valor" ordenacao={ordenacao} direcao={direcao} onChange={(c, d) => { setOrdenacao(c); setDirecao(d); }} />
                    </TableHead>
                    <TableHead className="min-w-[70px] text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((aluguel) => (
                    <TableRow key={aluguel.id} className="cursor-pointer select-none" onDoubleClick={() => onAcao("detalhes", aluguel)}>
                      <TableCell className="font-mono">{aluguel.id}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium" title={nomeDoCliente(aluguel)}>{nomeDoCliente(aluguel)}</span>
                          <DestinatarioBadge aluguel={aluguel} />
                        </div>
                        {aluguel.cliente?.telefone || aluguel.cliente_telefone ? (
                          <span className="text-[11px] text-muted-foreground">{aluguel.cliente?.telefone || aluguel.cliente_telefone}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="line-clamp-2" title={aluguel.itens.map((i) => `${i.quantidade}× ${i.descricao} (${ROTULO_TIPO_ITEM_ALUGUEL[i.tipo]})`).join("\n")}>
                          {resumoItens(aluguel)}
                        </span>
                      </TableCell>
                      <TableCell>{fmtData(aluguel.data_inicio)}</TableCell>
                      <TableCell>{fmtLimite(aluguel.data_limite)}</TableCell>
                      <TableCell><DiasAluguel aluguel={aluguel} /></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusAluguelBadge aluguel={aluguel} />
                          <RetornoParcialBadge aluguel={aluguel} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoeda(aluguel.valor_total)}</TableCell>
                      <TableCell className="text-center" onDoubleClick={(e) => e.stopPropagation()}>
                        <RowActions aluguel={aluguel} onAcao={onAcao} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!carregando && !linhas.length ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                        Nenhum aluguel encontrado.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 sm:justify-between">
          <div className="flex flex-nowrap text-xs text-muted-foreground">
            <span>{inicio}</span> - <span>{fim}</span>
            <span className="ml-1 hidden sm:block">de {total}</span>
            <Loader className={`ml-2 h-full w-4 animate-spin transition-all ${carregando ? "opacity-100" : "opacity-0"}`} aria-label="carregando" />
          </div>
          <div className="flex items-center justify-center space-x-1 sm:space-x-3">
            <Button variant="outline" size="icon" aria-label="Primeira página" onClick={() => setPage(1)} disabled={page === 1}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Página anterior" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="text-nowrap text-xs font-medium">Pg. {page} de {totalPages || 1}</span>
            <Button variant="outline" size="icon" aria-label="Próxima página" onClick={() => setPage(Math.min(totalPages || 1, page + 1))} disabled={page >= totalPages}>
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Última página" onClick={() => setPage(totalPages || 1)} disabled={page >= totalPages}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
          <Select value={String(limit)} onValueChange={(valor) => { setPage(1); setLimit(Number(valor)); }}>
            <SelectTrigger className="ml-2 w-20 hover:cursor-pointer" aria-label="Itens por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
