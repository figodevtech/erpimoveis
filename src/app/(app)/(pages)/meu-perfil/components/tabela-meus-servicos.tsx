// src/app/(app)/(pages)/meu-perfil/components/tabela-meus-servicos.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buscarIndicadoresServicos, buscarMeusServicos } from "../lib/api";
import { formatarDataHora, formatarMoeda, formatarQuantidade } from "../lib/format";
import { useListaPaginada } from "../hooks/use-lista-paginada";
import type { IndicadoresServicos, MeuServico, Periodo } from "../types";
import { DescricaoServico } from "./descricao-servico";
import { DivisaoDoServico } from "./divisao-servico";
import { IndicadoresDeServicos } from "./indicadores-servicos";
import { StatusBadge } from "./status-badge";
import {
  CartaoTabela,
  CorpoAnimado,
  LinhaAnimada,
  LinhaErro,
  LinhaVazia,
  LinhasCarregando,
  Paginacao,
} from "./tabela-shell";

const COLUNAS = 7;
const LIMITE = 15;

export function TabelaMeusServicos({ periodo, ativo, usuarioId }: { periodo: Periodo; ativo: boolean; usuarioId?: string }) {
  const buscar = useCallback(
    ({ page, limit, signal }: { page: number; limit: number; signal: AbortSignal }) =>
      buscarMeusServicos({ ...periodo, page, limit, signal, usuarioId }),
    [periodo, usuarioId],
  );

  const lista = useListaPaginada<MeuServico>({
    buscar,
    limit: LIMITE,
    ativo,
    chaveDeReset: `${periodo.de}|${periodo.ate}|${usuarioId ?? "me"}`,
  });

  /*
   * Os totais cobrem o periodo inteiro, nao a pagina — mesmo padrao de estado
   * derivado das outras abas: a chave da consulta viaja com o resultado, entao
   * "carregando" nao precisa de setState dentro do efeito.
   */
  const chaveIndicadores = `${periodo.de}|${periodo.ate}|${usuarioId ?? "me"}`;
  const [estadoIndicadores, setEstadoIndicadores] = useState<{
    chave: string;
    dados: IndicadoresServicos | null;
  }>({ chave: "", dados: null });
  const carregandoIndicadores = ativo && estadoIndicadores.chave !== chaveIndicadores;

  useEffect(() => {
    if (!ativo) return;

    const controller = new AbortController();

    buscarIndicadoresServicos(periodo, usuarioId, controller.signal)
      .then((dados) => {
        if (!controller.signal.aborted) setEstadoIndicadores({ chave: chaveIndicadores, dados });
      })
      .catch(() => {
        if (!controller.signal.aborted) setEstadoIndicadores({ chave: chaveIndicadores, dados: null });
      });

    return () => controller.abort();
  }, [ativo, chaveIndicadores, periodo, usuarioId]);

  return (
    <div className="flex flex-col gap-3">
      <IndicadoresDeServicos dados={estadoIndicadores.dados} carregando={carregandoIndicadores} />

      <CartaoTabela>
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">OS</TableHead>
            <TableHead>Serviço</TableHead>
            <TableHead className="w-40">Cliente</TableHead>
            <TableHead className="w-36">Status da OS</TableHead>
            <TableHead className="w-40">Fim da execução</TableHead>
            <TableHead className="w-24 text-right">Qtd.</TableHead>
            <TableHead className="w-32 text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>

        <CorpoAnimado key={`${periodo.de}|${periodo.ate}|${lista.page}`}>
          {lista.erro ? (
            <LinhaErro colunas={COLUNAS} mensagem={lista.erro} onTentarNovamente={lista.recarregar} />
          ) : lista.carregando && lista.items.length === 0 ? (
            <LinhasCarregando colunas={COLUNAS} />
          ) : lista.items.length === 0 ? (
            <LinhaVazia
              colunas={COLUNAS}
              mensagem="Nenhum serviço realizado em seu nome no período selecionado."
            />
          ) : (
            lista.items.map((servico) => (
              <LinhaAnimada key={`${servico.ordemId}-${servico.servicoId}`}>
                <TableCell className="font-medium tabular-nums">#{servico.ordemId}</TableCell>

                <TableCell className="max-w-[20rem]">
                  <div className="flex min-w-0 items-start gap-2">
                    <DescricaoServico
                      descricao={servico.descricao}
                      subdescricao={servico.subdescricao}
                      observacao={servico.observacao}
                      className="flex-1"
                    />
                    {/* So o servico que comissiona ganha selo. Marcar tambem os
                        que nao comissionam encheria a coluna de ruido, e o que
                        se procura na lista e o trabalho que rende. */}
                    {servico.geraComissao && (
                      <Badge
                        variant="outline"
                        className="mt-0.5 shrink-0 border-transparent bg-green-600/15 font-medium text-green-700 dark:text-green-400"
                      >
                        Comissão
                      </Badge>
                    )}
                    <span className="mt-0.5">
                      <DivisaoDoServico
                        realizadores={servico.realizadores}
                        valorDoServico={servico.subtotal}
                        valorBase={servico.valorBase}
                      />
                    </span>
                  </div>
                </TableCell>

                <TableCell className="max-w-[10rem] truncate text-muted-foreground">
                  {servico.ordem.cliente?.nome ?? "Sem cliente"}
                </TableCell>

                <TableCell>
                  <StatusBadge status={servico.ordem.status} />
                </TableCell>

                <TableCell className="text-muted-foreground tabular-nums">
                  {formatarDataHora(servico.ordem.concluidaEm)}
                </TableCell>

                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatarQuantidade(servico.quantidade)}
                </TableCell>

                <TableCell className="text-right font-medium tabular-nums">
                  {formatarMoeda(servico.subtotal)}
                </TableCell>
              </LinhaAnimada>
            ))
          )}
        </CorpoAnimado>
      </Table>

        <Paginacao
          page={lista.page}
          totalPages={lista.totalPages}
          total={lista.total}
          rotuloItens={lista.total === 1 ? "serviço" : "serviços"}
          onMudarPagina={lista.irParaPagina}
        />
      </CartaoTabela>
    </div>
  );
}
