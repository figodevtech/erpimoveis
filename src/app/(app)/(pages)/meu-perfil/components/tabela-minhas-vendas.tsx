// src/app/(app)/(pages)/meu-perfil/components/tabela-minhas-vendas.tsx
"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buscarIndicadoresVendas, buscarMinhasVendas } from "../lib/api";
import { formatarData, formatarMoeda, formatarQuantidade, rotuloDeStatus } from "../lib/format";
import { useListaPaginada } from "../hooks/use-lista-paginada";
import type { IndicadoresVendas, MinhaVenda, Periodo } from "../types";
import { IndicadoresDeVendas } from "./indicadores-vendas";
import { StatusBadge } from "./status-badge";
import {
  BotaoExpandir,
  CartaoTabela,
  CorpoAnimado,
  LinhaAnimada,
  LinhaDeDetalhe,
  LinhaErro,
  LinhaVazia,
  LinhasCarregando,
  Paginacao,
} from "./tabela-shell";

const COLUNAS = 7;
const LIMITE = 10;

export function TabelaMinhasVendas({ periodo, ativo, usuarioId }: { periodo: Periodo; ativo: boolean; usuarioId?: string }) {
  const [expandidas, setExpandidas] = useState<ReadonlySet<number>>(new Set());

  const buscar = useCallback(
    ({ page, limit, signal }: { page: number; limit: number; signal: AbortSignal }) =>
      buscarMinhasVendas({ ...periodo, page, limit, signal, usuarioId }),
    [periodo, usuarioId],
  );

  const lista = useListaPaginada<MinhaVenda>({
    buscar,
    limit: LIMITE,
    ativo,
    chaveDeReset: `${periodo.de}|${periodo.ate}|${usuarioId ?? "me"}`,
  });

  /*
   * Os totais cobrem o periodo inteiro, nao a pagina — por isso vivem em outro
   * endpoint e so sao buscados quando o periodo muda. Mesmo padrao de estado
   * derivado do resto da Central: a chave da consulta viaja junto com o
   * resultado, entao "carregando" nao precisa de setState dentro do efeito.
   */
  const chaveIndicadores = `${periodo.de}|${periodo.ate}|${usuarioId ?? "me"}`;
  const [estadoIndicadores, setEstadoIndicadores] = useState<{
    chave: string;
    dados: IndicadoresVendas | null;
  }>({ chave: "", dados: null });
  const carregandoIndicadores = ativo && estadoIndicadores.chave !== chaveIndicadores;

  useEffect(() => {
    if (!ativo) return;

    const controller = new AbortController();

    buscarIndicadoresVendas(periodo, usuarioId, controller.signal)
      .then((dados) => {
        if (!controller.signal.aborted) setEstadoIndicadores({ chave: chaveIndicadores, dados });
      })
      .catch(() => {
        if (!controller.signal.aborted) setEstadoIndicadores({ chave: chaveIndicadores, dados: null });
      });

    return () => controller.abort();
  }, [ativo, chaveIndicadores, periodo, usuarioId]);

  const alternar = (id: number) =>
    setExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

  return (
    <div className="flex flex-col gap-3">
      <IndicadoresDeVendas dados={estadoIndicadores.dados} carregando={carregandoIndicadores} />

      <CartaoTabela>
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead className="w-20">Venda</TableHead>
            {/* Eixo de periodo da aba: a coluna mostra a mesma data que filtra. */}
            <TableHead className="w-28">Pagamento</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead className="w-32">Canal</TableHead>
            <TableHead className="w-36">Status</TableHead>
            <TableHead className="w-32 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>

        {/* A key faz a entrada escalonada tocar de novo a cada pagina. */}
        <CorpoAnimado key={`${periodo.de}|${periodo.ate}|${lista.page}`}>
          {lista.erro ? (
            <LinhaErro colunas={COLUNAS} mensagem={lista.erro} onTentarNovamente={lista.recarregar} />
          ) : lista.carregando && lista.items.length === 0 ? (
            <LinhasCarregando colunas={COLUNAS} />
          ) : lista.items.length === 0 ? (
            <LinhaVazia colunas={COLUNAS} mensagem="Nenhuma venda sua no período selecionado." />
          ) : (
            lista.items.map((venda) => {
              const aberta = expandidas.has(venda.id);

              return (
                <Fragment key={venda.id}>
                  <LinhaAnimada>
                    <TableCell className="py-2">
                      <BotaoExpandir
                        aberto={aberta}
                        controla={`venda-itens-${venda.id}`}
                        rotulo={`${aberta ? "Ocultar" : "Mostrar"} itens da venda ${venda.id}`}
                        onClick={() => alternar(venda.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">#{venda.id}</TableCell>
                    <TableCell className="tabular-nums">{formatarData(venda.pagamentoEm)}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">
                      {venda.cliente?.nome ?? "Consumidor final"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{rotuloDeStatus(venda.canal)}</TableCell>
                    <TableCell>
                      <StatusBadge status={venda.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatarMoeda(venda.valorTotal)}
                    </TableCell>
                  </LinhaAnimada>

                  <AnimatePresence initial={false}>
                    {aberta && (
                      <LinhaDeDetalhe id={`venda-itens-${venda.id}`} colunas={COLUNAS}>
                        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Itens da venda
                        </h3>

                        {venda.itens.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Esta venda não possui itens.</p>
                        ) : (
                          <ul className="grid gap-1.5">
                            {venda.itens.map((item) => (
                              <li
                                key={item.id}
                                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/60 pb-1.5 text-sm last:border-0 last:pb-0"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {item.titulo}
                                  {item.referencia && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {item.referencia}
                                    </span>
                                  )}
                                </span>
                                <span className="text-muted-foreground tabular-nums">
                                  {formatarQuantidade(item.quantidade)}
                                  {item.unidade ? ` ${item.unidade}` : ""} ×{" "}
                                  {formatarMoeda(item.valorUnitario)}
                                </span>
                                {/* `ml-auto`: quando a linha quebra, o valor
                                    continua ancorado a direita. */}
                                <span className="ml-auto w-28 text-right font-medium tabular-nums">
                                  {formatarMoeda(item.valorTotal)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Trilha da venda: quando virou orçamento, quando foi
                            para pagamento e quando foi baixada. Cada marco é
                            nulo enquanto a venda não passou por ele. */}
                        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                          <div className="flex gap-1.5">
                            <dt>Orçamento:</dt>
                            <dd className="tabular-nums">{formatarData(venda.orcamentoEm)}</dd>
                          </div>
                          <div className="flex gap-1.5">
                            <dt>Pagamento:</dt>
                            <dd className="tabular-nums">{formatarData(venda.pagamentoEm)}</dd>
                          </div>
                          <div className="flex gap-1.5">
                            <dt>Baixa:</dt>
                            <dd className="tabular-nums">{formatarData(venda.baixadaEm)}</dd>
                          </div>
                        </dl>

                        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                          <div className="flex gap-1.5">
                            <dt>Subtotal:</dt>
                            <dd className="tabular-nums">{formatarMoeda(venda.subTotal)}</dd>
                          </div>
                          {venda.valorFrete > 0 && (
                            <div className="flex gap-1.5">
                              <dt>Frete:</dt>
                              <dd className="tabular-nums">{formatarMoeda(venda.valorFrete)}</dd>
                            </div>
                          )}
                          {venda.formaPagamento && (
                            <div className="flex gap-1.5">
                              <dt>Forma de pagamento:</dt>
                              <dd>{rotuloDeStatus(venda.formaPagamento)}</dd>
                            </div>
                          )}
                        </dl>
                      </LinhaDeDetalhe>
                    )}
                  </AnimatePresence>
                </Fragment>
              );
            })
          )}
        </CorpoAnimado>
      </Table>

        <Paginacao
          page={lista.page}
          totalPages={lista.totalPages}
          total={lista.total}
          rotuloItens={lista.total === 1 ? "venda" : "vendas"}
          onMudarPagina={lista.irParaPagina}
        />
      </CartaoTabela>
    </div>
  );
}
