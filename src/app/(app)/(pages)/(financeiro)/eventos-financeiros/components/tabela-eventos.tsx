"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter, Inbox, RefreshCw, Search, X } from "lucide-react";
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
import type { ResultadoSelecaoDeEventos } from "@/lib/financeiro/eventos-financeiros-selection";

import {
  FILTROS_VAZIOS,
  ORIGENS_DISPONIVEIS,
  SITUACAO_TABS,
  type FiltrosDeEventos,
  type Paginacao,
  type SituacaoEvento,
  type UsuarioDeEvento,
} from "../types";

const LIMIT_OPTIONS = [25, 50, 100, 200];

const ENDPOINTS = endpointsDoFinanceiro();

export function TabelaEventos({
  linhas,
  isLoading,
  erro,
  situacao,
  setSituacao,
  busca,
  setBusca,
  filtros,
  setFiltros,
  usuarios,
  carregandoUsuarios,
  paginacao,
  irParaPagina,
  setLimit,
  recarregar,
  permissoes,
  totalSelecionaveis,
  escopoSelecao,
  carregarSelecionaveisDoFiltro,
}: {
  linhas: LinhaDeEvento[];
  isLoading: boolean;
  erro: string | null;
  situacao: SituacaoEvento;
  setSituacao: (valor: SituacaoEvento) => void;
  busca: string;
  setBusca: (valor: string) => void;
  filtros: FiltrosDeEventos;
  setFiltros: (valor: FiltrosDeEventos) => void;
  usuarios: UsuarioDeEvento[];
  carregandoUsuarios: boolean;
  paginacao: Paginacao;
  irParaPagina: (pagina: number) => void;
  setLimit: (limite: number) => void;
  recarregar: () => void | Promise<void>;
  permissoes: { podeEditar: boolean; podeExcluir: boolean; podeLancar: boolean };
  totalSelecionaveis: number;
  escopoSelecao: string;
  carregarSelecionaveisDoFiltro: () => Promise<ResultadoSelecaoDeEventos>;
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
  const rotulos: Record<keyof FiltrosDeEventos, string> = {
    documentoTipo: "Documento", natureza: "Natureza", origem: "Origem", osId: "OS",
    usuarioId: "Pessoa", dateFrom: "De", dateTo: "Até",
  };
  function valorDoFiltro(chave: keyof FiltrosDeEventos, valor: string) {
    if (chave === "usuarioId") return usuarios.find((usuario) => usuario.id === valor)?.nome || "Usuário selecionado";
    if (chave === "dateFrom" || chave === "dateTo") return valor.split("-").reverse().join("/");
    if (valor === "VENDA") return "Vendas";
    if (valor === "OS") return "Ordens de serviço";
    return valor.charAt(0) + valor.slice(1).toLowerCase().replaceAll("_", " ");
  }

  return (
    <Card className="gap-0 overflow-hidden rounded-xl py-0 shadow-sm">
      <CardHeader className="grid-rows-1 gap-4 border-b px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div
            role="group"
            aria-label="Situação dos eventos"
            className="flex w-full rounded-lg bg-muted/60 p-1 sm:w-fit"
          >
            {SITUACAO_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={situacao === tab.value}
                onClick={() => setSituacao(tab.value)}
                className={`flex-1 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none ${
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
              className="relative flex min-w-0 basis-full gap-2 sm:min-w-64 sm:basis-auto"
              onSubmit={(event) => {
                event.preventDefault();
                setBusca(buscaLocal.trim());
              }}
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={buscaLocal}
                onChange={(event) => setBuscaLocal(event.target.value)}
                placeholder="Descrição, nº da OS ou venda"
                aria-label="Buscar eventos financeiros"
                className="h-9 min-w-0 pl-8 pr-8 sm:w-72"
              />
              {buscaLocal ? (
                <button
                  type="button"
                  aria-label="Limpar busca"
                  className="absolute right-[5.25rem] top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setBuscaLocal("");
                    setBusca("");
                  }}
                >
                  <X className="size-4" />
                </button>
              ) : null}
              <Button type="submit" variant="outline" size="sm">Buscar</Button>
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
              <SheetContent className="flex flex-col gap-4 sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Filtrar eventos</SheetTitle>
                  <SheetDescription>
                    Os filtros valem para a lista e para os totais do topo.
                  </SheetDescription>
                </SheetHeader>

                <div className="space-y-4 overflow-y-auto px-4">
                  <label className="block text-sm font-medium">
                    Documento
                    <Select value={rascunho.documentoTipo || "TODOS"} onValueChange={(valor) => setRascunho({ ...rascunho, documentoTipo: valor === "TODOS" ? "" : valor as "OS" | "VENDA" })}>
                      <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TODOS">OS e vendas</SelectItem>
                        <SelectItem value="OS">Ordens de serviço</SelectItem>
                        <SelectItem value="VENDA">Vendas</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
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

                  <label className="block text-sm font-medium">
                    Usuário
                    <Select
                      value={rascunho.usuarioId || "TODOS"}
                      onValueChange={(valor) =>
                        setRascunho({
                          ...rascunho,
                          usuarioId: valor === "TODOS" ? "" : valor,
                        })
                      }
                      disabled={carregandoUsuarios && usuarios.length === 0}
                    >
                      <SelectTrigger className="mt-1 w-full">
                        <SelectValue
                          placeholder={carregandoUsuarios ? "Carregando usuários..." : "Todos os usuários"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TODOS">Todos os usuários</SelectItem>
                        {usuarios.map((usuario) => (
                          <SelectItem key={usuario.id} value={usuario.id}>
                            {usuario.nome || usuario.email || usuario.id}
                            {usuario.ativo ? "" : " (inativo)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      Pessoa vinculada ao evento, como o beneficiário de uma comissão.
                    </span>
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
        {busca || filtrosAtivos > 0 ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="Filtros aplicados">
            {busca ? <Badge variant="secondary" className="gap-2 py-1.5 font-normal">Busca: {busca}<button aria-label="Remover busca" onClick={() => { setBusca(""); setBuscaLocal(""); }}><X className="size-3.5" /></button></Badge> : null}
            {(Object.entries(filtros) as [keyof FiltrosDeEventos, string][]).filter(([, valor]) => valor).map(([chave, valor]) => (
              <Badge key={chave} variant="secondary" className="max-w-full gap-2 py-1.5 font-normal">
                <span className="truncate">{rotulos[chave]}: {valorDoFiltro(chave, valor)}</span>
                <button aria-label={`Remover filtro ${rotulos[chave]}`} onClick={() => setFiltros({ ...filtros, [chave]: "" })}><X className="size-3.5" /></button>
              </Badge>
            ))}
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setFiltros(FILTROS_VAZIOS); setBusca(""); setBuscaLocal(""); }}>Limpar filtros</Button>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className={`p-3 sm:p-5 ${isLoading && linhas.length > 0 ? "opacity-50" : ""}`} aria-busy={isLoading} inert={isLoading}>
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
        ) : erro ? <p className="p-8 text-center text-sm text-muted-foreground">A lista estará disponível após carregar os eventos.</p> : (
          <PainelEventosFinanceiros
            linhas={linhas}
            endpoints={ENDPOINTS}
            permissoes={permissoes}
            totalSelecionaveis={totalSelecionaveis}
            escopoSelecao={escopoSelecao}
            carregarSelecionaveisDoFiltro={carregarSelecionaveisDoFiltro}
            onChanged={recarregar}
            vazio={
              <div className="flex flex-col items-center px-5 py-14 text-center">
                <span className="mb-4 rounded-2xl bg-muted p-4"><Inbox className="size-7 text-muted-foreground" /></span>
                <p className="font-medium">{situacao === "NAO_LANCADO" ? "Nenhuma pendência neste filtro" : "Nenhum evento encontrado"}</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">{situacao === "NAO_LANCADO" ? "Não há despesas aguardando lançamento. Consulte todos os eventos ou ajuste os filtros." : "Experimente outro período, documento ou termo de busca."}</p>
                {situacao !== "TODOS" ? <Button variant="outline" size="sm" className="mt-4" onClick={() => setSituacao("TODOS")}>Ver todos os eventos</Button> : null}
              </div>
            }
          />
        )}
      </CardContent>

      <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{erro ? "—" : `${paginacao.total === 0 ? 0 : (paginacao.page - 1) * paginacao.limit + 1}–${Math.min(paginacao.page * paginacao.limit, paginacao.total)} de ${paginacao.total}`} eventos</span>
          <Select value={String(paginacao.limit)} onValueChange={(valor) => setLimit(Number(valor))}>
            <SelectTrigger className="h-8 w-[5.5rem]" aria-label="Eventos por página">
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
