"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { CheckCircle2, ListChecks, Search, X } from "lucide-react";

import TransactionDialog from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { ItemPendencia, PendenciaDre, PeriodoDre } from "../types";
import {
  ClassificarCadastroDialog,
  type AlvoClassificacao,
  type LoteClassificacao,
} from "./classificar-cadastro-dialog";
import { CorrigirCustoDialog } from "./corrigir-custo-dialog";
import { escopoEmTexto, motivoDaPendencia } from "./pendencias-catalogo";

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (v: number) => MOEDA.format(Number.isFinite(v) ? v : 0);

/** Quantos itens a rota devolve por vez. "Carregar mais" sobe de lote em lote. */
const PAGINA = 100;

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

const chaveDoItem = (item: ItemPendencia) => `${item.referencia_tipo}-${item.referencia_id}`;

/** "2026-08-14" -> "14/08/2026". A rota devolve data, não instante: não há fuso a errar. */
function competenciaEmTexto(competencia: string | null) {
  if (!competencia) return "—";
  const data = competencia.slice(0, 10).split("-");
  return data.length === 3 ? `${data[2]}/${data[1]}/${data[0]}` : competencia;
}

/**
 * Lista os itens de uma pendência e leva cada um ao formulário que o resolve —
 * sem sair da DRE, que é onde a pessoa viu o problema.
 *
 * Itens de cadastro (conta e grupo) aceitam seleção: dar a mesma linha a 40
 * contas uma a uma é o tipo de trabalho que faz o usuário desistir da fila.
 */
export function PendenciasDialog({
  pendencia,
  periodo,
  onFechar,
  onCorrigido,
}: {
  pendencia: PendenciaDre | null;
  periodo: PeriodoDre;
  onFechar: () => void;
  /** Dispara o recarregamento da DRE: o total e a tarja acompanham na hora. */
  onCorrigido: () => void;
}) {
  const { data: session } = useSession();
  const permissoes = (session?.user as any)?.permissoes;
  const podeEditarEstoque = permissionSetHas(permissoes, PERMS.ESTOQUE_EDITAR);
  const podeEditarConfig = permissionSetHas(permissoes, PERMS.CONFIG_EDITAR);

  const motivo = pendencia?.motivo ?? "";
  const catalogo = motivoDaPendencia(motivo, pendencia?.descricao);

  const [limite, setLimite] = useState(PAGINA);
  const [recarregar, setRecarregar] = useState(0);
  const chave = pendencia ? `${motivo}|${periodo.de}|${periodo.ate}|${limite}|${recarregar}` : "";
  const [resultado, setResultado] = useState<{ chave: string; itens: ItemPendencia[]; erro: string | null }>({
    chave: "",
    itens: [],
    erro: null,
  });

  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());

  const [custoAberto, setCustoAberto] = useState<number | null>(null);
  const [cadastroAberto, setCadastroAberto] = useState<AlvoClassificacao>(null);
  const [loteAberto, setLoteAberto] = useState<LoteClassificacao>(null);
  const [transacaoAberta, setTransacaoAberta] = useState<number | undefined>(undefined);

  const carregando = !!pendencia && resultado.chave !== chave;
  const primeiraCarga = carregando && resultado.chave === "";
  const itens = resultado.itens;

  useEffect(() => {
    if (!pendencia) return;
    const controller = new AbortController();

    fetch(
      `/api/dre/pendencias?motivo=${encodeURIComponent(motivo)}&de=${periodo.de}&ate=${periodo.ate}&limite=${limite}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (resposta) => {
        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(corpo?.error || "Não foi possível carregar os itens.");
        return corpo as { itens?: ItemPendencia[] };
      })
      .then((corpo) => {
        if (controller.signal.aborted) return;
        setResultado({ chave, itens: corpo.itens ?? [], erro: null });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResultado((atual) => ({
          ...atual,
          chave,
          erro: e instanceof Error ? e.message : "Não foi possível carregar os itens.",
        }));
      });

    return () => controller.abort();
  }, [chave, limite, motivo, pendencia, periodo.ate, periodo.de]);

  /** Depois de gravar, a lista e a DRE precisam refletir o que mudou. */
  const apósCorrigir = useCallback(() => {
    setMarcados(new Set());
    setRecarregar((n) => n + 1);
    onCorrigido();
  }, [onCorrigido]);

  /**
   * O que abrir para cada item. `null` some com o botão: oferecer um "Corrigir"
   * que não abre nada é pior que não oferecer — era o que acontecia com
   * "lançamento sem linha", cujo item é um evento, e evento não se edita.
   */
  function acaoDoItem(item: ItemPendencia): "CUSTO" | "CADASTRO" | "TRANSACAO" | null {
    if (!catalogo.acao) return null;
    if (motivo === "ITEM_SEM_CUSTO") return "CUSTO";
    if (item.referencia_tipo === "CONTA" || item.referencia_tipo === "GRUPO") return "CADASTRO";
    if (item.referencia_tipo === "TRANSACAO") return "TRANSACAO";
    // Evento de OS ou de venda se conserta no documento, não aqui.
    if (item.referencia_tipo === "EVENTO" && item.documento?.tipo === "TRANSACAO") return "TRANSACAO";
    return null;
  }

  function abrirCorrecao(item: ItemPendencia) {
    switch (acaoDoItem(item)) {
      case "CUSTO":
        setCustoAberto(item.referencia_id);
        return;
      case "CADASTRO":
        setCadastroAberto({
          tipo: item.referencia_tipo === "GRUPO" ? "GRUPO" : "CONTA",
          id: item.referencia_id,
          nome: item.descricao ?? item.conta ?? item.grupo ?? `#${item.referencia_id}`,
        });
        return;
      case "TRANSACAO":
        setTransacaoAberta(
          item.referencia_tipo === "TRANSACAO" ? item.referencia_id : (item.documento?.id ?? undefined),
        );
        return;
      default:
        return;
    }
  }

  const termo = normalizar(busca.trim());
  const visiveis = useMemo(
    () =>
      !termo
        ? itens
        : itens.filter((item) =>
            [item.descricao, item.conta, item.grupo].some((campo) => !!campo && normalizar(campo).includes(termo)),
          ),
    [itens, termo],
  );

  /** Lote só faz sentido em cadastro, e só com itens do mesmo tipo. */
  const tipoDoLote =
    itens.length && itens.every((item) => item.referencia_tipo === itens[0].referencia_tipo)
      ? itens[0].referencia_tipo
      : null;
  const permiteLote = (tipoDoLote === "CONTA" || tipoDoLote === "GRUPO") && !!catalogo.acao;
  const marcadosVisiveis = visiveis.filter((item) => marcados.has(chaveDoItem(item)));
  const todosMarcados = visiveis.length > 0 && marcadosVisiveis.length === visiveis.length;

  function alternarItem(item: ItemPendencia) {
    const id = chaveDoItem(item);
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function alternarTodos() {
    setMarcados(todosMarcados ? new Set() : new Set(visiveis.map(chaveDoItem)));
  }

  function abrirLote() {
    if (!permiteLote || !tipoDoLote) return;
    setLoteAberto({
      tipo: tipoDoLote,
      itens: marcadosVisiveis.map((item) => ({
        id: item.referencia_id,
        nome: item.descricao ?? item.conta ?? item.grupo ?? `#${item.referencia_id}`,
      })),
    });
  }

  const Icone = catalogo.icone;
  const podeVerMais = !carregando && itens.length >= limite;

  return (
    <>
      <Dialog open={!!pendencia} onOpenChange={(aberto) => !aberto && onFechar()}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="space-y-0 border-b px-5 py-4 text-left sm:px-6">
            <div className="flex items-start gap-3 pr-8">
              <span
                className={cn(
                  "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md",
                  catalogo.tom === "PROBLEMA"
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icone className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-base leading-tight">{catalogo.titulo}</DialogTitle>
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant="outline" className="h-5 px-1.5 font-normal">
                    {escopoEmTexto(pendencia?.escopo ?? "")}
                  </Badge>
                  <span className="tabular-nums">{pendencia?.quantidade ?? 0} item(ns)</span>
                  {pendencia?.valor ? <span className="tabular-nums">· {brl(pendencia.valor)}</span> : null}
                  {pendencia?.escopo === "PERIODO" && (
                    <span className="tabular-nums">
                      · {competenciaEmTexto(periodo.de)} a {competenciaEmTexto(periodo.ate)}
                    </span>
                  )}
                </DialogDescription>
              </div>
            </div>
            <p className="mt-3 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              {catalogo.explicacao}
            </p>
          </DialogHeader>

          {(itens.length > 8 || permiteLote) && (
            <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5 sm:px-6">
              {permiteLote && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={todosMarcados} onCheckedChange={alternarTodos} aria-label="Marcar todos" />
                  Marcar todos
                </label>
              )}
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={busca}
                  onChange={(evento) => setBusca(evento.target.value)}
                  placeholder="Buscar na lista…"
                  aria-label="Buscar itens da pendência"
                  className="h-8 pl-8"
                />
              </div>
              {permiteLote && marcadosVisiveis.length > 0 && (
                <Button size="sm" className="h-8" onClick={abrirLote}>
                  <ListChecks className="mr-1.5 size-4" aria-hidden />
                  Definir linha de {marcadosVisiveis.length}
                </Button>
              )}
            </div>
          )}

          <div className={cn("min-h-0 flex-1 overflow-y-auto", carregando && !primeiraCarga && "opacity-60")}>
            {resultado.erro ? (
              <p className="px-6 py-10 text-center text-sm text-destructive">{resultado.erro}</p>
            ) : primeiraCarga ? (
              <ul className="divide-y">
                {Array.from({ length: 6 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                    <Skeleton className="h-4 w-4/6" />
                    <Skeleton className="ml-auto h-4 w-20" />
                  </li>
                ))}
              </ul>
            ) : visiveis.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <CheckCircle2 className="size-8 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">{itens.length ? "Nada com esse termo" : "Nada pendente aqui"}</p>
                {itens.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setBusca("")}>
                    <X className="mr-1.5 size-3.5" aria-hidden />
                    Limpar busca
                  </Button>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {visiveis.map((item) => {
                  const acao = acaoDoItem(item);
                  const marcado = marcados.has(chaveDoItem(item));
                  return (
                    <li
                      key={chaveDoItem(item)}
                      className={cn(
                        "flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/40 sm:px-6",
                        marcado && "bg-primary/5",
                      )}
                    >
                      {permiteLote && (
                        <Checkbox
                          checked={marcado}
                          onCheckedChange={() => alternarItem(item)}
                          aria-label={`Marcar ${item.descricao ?? item.referencia_id}`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" title={item.descricao ?? undefined}>
                          {item.descricao ?? `#${item.referencia_id}`}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[item.grupo, item.conta].filter(Boolean).join(" · ") || "sem conta"}
                          {item.competencia ? ` · ${competenciaEmTexto(item.competencia)}` : ""}
                        </p>
                      </div>
                      {item.valor !== null && (
                        <span className="shrink-0 text-sm tabular-nums">{brl(item.valor)}</span>
                      )}
                      {acao && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0"
                          onClick={() => abrirCorrecao(item)}
                        >
                          {catalogo.acao}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {podeVerMais && (
              <div className="border-t px-5 py-3 text-center sm:px-6">
                <Button size="sm" variant="outline" onClick={() => setLimite((atual) => atual + PAGINA)}>
                  Carregar mais
                </Button>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground sm:px-6">
            <span>
              {carregando && !primeiraCarga
                ? "atualizando…"
                : `Mostrando ${visiveis.length} de ${pendencia?.quantidade ?? visiveis.length}`}
            </span>
            {!catalogo.acao && <span>Sem correção por esta tela.</span>}
          </footer>
        </DialogContent>
      </Dialog>

      <CorrigirCustoDialog
        eventoId={custoAberto}
        podeEditarEstoque={podeEditarEstoque}
        onFechar={() => setCustoAberto(null)}
        onCorrigido={apósCorrigir}
      />

      <ClassificarCadastroDialog
        alvo={cadastroAberto}
        lote={loteAberto}
        podeEditar={podeEditarConfig}
        onFechar={() => {
          setCadastroAberto(null);
          setLoteAberto(null);
        }}
        onClassificado={apósCorrigir}
      />

      {/* O formulário do financeiro, com a transação já carregada — o mesmo que
          o usuário usa no fluxo de caixa, para não aprender outro aqui. */}
      <TransactionDialog
        open={transacaoAberta !== undefined}
        setOpen={(aberto) => !aberto && setTransacaoAberta(undefined)}
        selectedTransactionId={transacaoAberta}
        setSelectedTransactionId={setTransacaoAberta}
        editable
        handleGetTransactions={apósCorrigir}
      />
    </>
  );
}
