"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter, RefreshCw, Search, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PainelEventosFinanceiros } from "@/components/financeiro/eventos-financeiros/painel-eventos-financeiros";
import { endpointsDoFinanceiro } from "@/components/financeiro/eventos-financeiros/endpoints";
import type { LinhaDeEvento } from "@/components/financeiro/eventos-financeiros/modelo";
import { Skeleton } from "@/components/ui/skeleton";

import {
  FILTROS_VAZIOS,
  ORIGENS_DISPONIVEIS,
  SITUACAO_TABS,
  type FiltrosDeEventos,
  type Paginacao,
  type SituacaoEvento,
} from "../types";

const LIMIT_OPTIONS = [25, 50, 100, 200];

const ENDPOINTS = endpointsDoFinanceiro();

export function TabelaEventos({
  linhas,
  isLoading,
  situacao,
  setSituacao,
  busca,
  setBusca,
  filtros,
  setFiltros,
  paginacao,
  irParaPagina,
  setLimit,
  recarregar,
  permissoes,
}: {
  linhas: LinhaDeEvento[];
  isLoading: boolean;
  situacao: SituacaoEvento;
  setSituacao: (valor: SituacaoEvento) => void;
  busca: string;
  setBusca: (valor: string) => void;
  filtros: FiltrosDeEventos;
  setFiltros: (valor: FiltrosDeEventos) => void;
  paginacao: Paginacao;
  irParaPagina: (pagina: number) => void;
  setLimit: (limite: number) => void;
  recarregar: () => void | Promise<void>;
  permissoes: { podeEditar: boolean; podeExcluir: boolean; podeLancar: boolean };
}) {
  const [filtroAberto, setFiltroAberto] = useState(false);
  // Rascunho: o filtro só vale quando o operador aplica, como no fluxo de caixa.
  // Cada mexida num select refazendo a busca deixaria a lista piscando.
  //
  // A sincronia com o que está aplicado acontece ao abrir a gaveta, e não por
  // efeito: só estes controles mudam `filtros` e `busca`, então um efeito
  // observando-os estaria copiando de volta o que ele mesmo acabou de mandar.
  const [rascunho, setRascunho] = useState<FiltrosDeEventos>(filtros);
  const [buscaLocal, setBuscaLocal] = useState(busca);

  const filtrosAtivos = Object.values(filtros).filter(Boolean).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="tablist"
            aria-label="Situação dos eventos"
            className="flex w-fit rounded-lg border bg-muted/40 p-0.5"
          >
            {SITUACAO_TABS.map((tab) => (
              <button
                key={tab.value}
                role="tab"
                type="button"
                aria-selected={situacao === tab.value}
                onClick={() => setSituacao(tab.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  situacao === tab.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form
              className="relative"
              onSubmit={(event) => {
                event.preventDefault();
                setBusca(buscaLocal.trim());
              }}
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={buscaLocal}
                onChange={(event) => setBuscaLocal(event.target.value)}
                placeholder="Descrição ou #OS"
                className="h-9 w-56 pl-8"
              />
              {buscaLocal ? (
                <button
                  type="button"
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setBuscaLocal("");
                    setBusca("");
                  }}
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </form>

            <Sheet
              open={filtroAberto}
              onOpenChange={(aberto) => {
                if (aberto) setRascunho(filtros);
                setFiltroAberto(aberto);
              }}
            >
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Filter className="size-4" /> Filtros
                  {filtrosAtivos ? (
                    <Badge variant="secondary" className="ml-1 rounded-full px-1.5 py-0 text-[10px]">
                      {filtrosAtivos}
                    </Badge>
                  ) : null}
                </Button>
              </SheetTrigger>
              <SheetContent className="flex flex-col gap-4">
                <SheetHeader>
                  <SheetTitle>Filtrar eventos</SheetTitle>
                  <SheetDescription>
                    Os filtros valem para a lista e para os totais do topo.
                  </SheetDescription>
                </SheetHeader>

                <div className="space-y-4 overflow-y-auto px-4">
                  <label className="block text-sm font-medium">
                    Natureza
                    <Select
                      value={rascunho.natureza || "TODAS"}
                      onValueChange={(valor) =>
                        setRascunho({
                          ...rascunho,
                          natureza: valor === "TODAS" ? "" : (valor as "RECEITA" | "DESPESA"),
                        })
                      }
                    >
                      <SelectTrigger className="mt-1 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TODAS">Todas</SelectItem>
                        <SelectItem value="DESPESA">Despesa</SelectItem>
                        <SelectItem value="RECEITA">Receita</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block text-sm font-medium">
                    Origem
                    <Select
                      value={rascunho.origem || "TODAS"}
                      onValueChange={(valor) =>
                        setRascunho({ ...rascunho, origem: valor === "TODAS" ? "" : valor })
                      }
                    >
                      <SelectTrigger className="mt-1 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TODAS">Todas</SelectItem>
                        {ORIGENS_DISPONIVEIS.map((origem) => (
                          <SelectItem key={origem} value={origem}>
                            {origem}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block text-sm font-medium">
                    Ordem de serviço
                    <Input
                      className="mt-1"
                      inputMode="numeric"
                      placeholder="Número da OS"
                      value={rascunho.osId}
                      onChange={(event) =>
                        setRascunho({ ...rascunho, osId: event.target.value.replace(/\D/g, "") })
                      }
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-sm font-medium">
                      De
                      <Input
                        type="date"
                        className="mt-1"
                        value={rascunho.dateFrom}
                        onChange={(event) => setRascunho({ ...rascunho, dateFrom: event.target.value })}
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      Até
                      <Input
                        type="date"
                        className="mt-1"
                        value={rascunho.dateTo}
                        onChange={(event) => setRascunho({ ...rascunho, dateTo: event.target.value })}
                      />
                    </label>
                  </div>
                </div>

                <SheetFooter className="flex-row gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setRascunho(FILTROS_VAZIOS);
                      setFiltros(FILTROS_VAZIOS);
                      setFiltroAberto(false);
                    }}
                  >
                    Limpar
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setFiltros(rascunho);
                      setFiltroAberto(false);
                    }}
                  >
                    Aplicar
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => void recarregar()}
              disabled={isLoading}
            >
              <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {isLoading && linhas.length === 0 ? (
          // Skeleton próprio, e não o `TableSkeleton`: aquele emite `TableRow` e
          // só funciona dentro de uma `<Table>`. Aqui as linhas são um grid.
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, indice) => (
              <div key={`sk-${indice}`} className="flex items-center gap-3 rounded-lg border p-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : (
          <PainelEventosFinanceiros
            linhas={linhas}
            endpoints={ENDPOINTS}
            permissoes={permissoes}
            agruparPorOs
            onChanged={recarregar}
            vazio={
              <p className="p-8 text-center text-sm text-muted-foreground">
                {situacao === "NAO_LANCADO"
                  ? "Nada pendente: todo evento financeiro das ordens já foi lançado no financeiro."
                  : "Nenhum evento financeiro para este filtro."}
              </p>
            }
          />
        )}
      </CardContent>

      <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{paginacao.total} evento(s)</span>
          <Select value={String(paginacao.limit)} onValueChange={(valor) => setLimit(Number(valor))}>
            <SelectTrigger className="h-8 w-[5.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMIT_OPTIONS.map((opcao) => (
                <SelectItem key={opcao} value={String(opcao)}>
                  {opcao} / pg
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Primeira página"
            disabled={paginacao.page <= 1 || isLoading}
            onClick={() => irParaPagina(1)}
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Página anterior"
            disabled={paginacao.page <= 1 || isLoading}
            onClick={() => irParaPagina(paginacao.page - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="px-2 text-xs tabular-nums text-muted-foreground">
            Pg. {paginacao.page} de {paginacao.totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Próxima página"
            disabled={paginacao.page >= paginacao.totalPages || isLoading}
            onClick={() => irParaPagina(paginacao.page + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Última página"
            disabled={paginacao.page >= paginacao.totalPages || isLoading}
            onClick={() => irParaPagina(paginacao.totalPages)}
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
