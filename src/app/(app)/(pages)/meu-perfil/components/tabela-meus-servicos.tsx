// src/app/(app)/(pages)/meu-perfil/components/tabela-meus-servicos.tsx
"use client";

import { useCallback } from "react";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buscarMeusServicos } from "../lib/api";
import { formatarDataHora, formatarMoeda, formatarQuantidade } from "../lib/format";
import { useListaPaginada } from "../hooks/use-lista-paginada";
import type { MeuServico, Periodo } from "../types";
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

  return (
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
                  <span className="block truncate">{servico.descricao}</span>
                  {servico.observacao && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block max-w-full cursor-help truncate text-xs text-muted-foreground">
                          {servico.observacao}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{servico.observacao}</TooltipContent>
                    </Tooltip>
                  )}
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
  );
}
