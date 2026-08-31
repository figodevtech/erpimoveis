// src/app/(app)/(pages)/meu-perfil/components/tabela-minhas-ordens.tsx
"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Package, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buscarIndicadoresOrdens, buscarMinhasOrdens } from "../lib/api";
import { formatarData, formatarMoeda, formatarQuantidade, rotuloDeStatus } from "../lib/format";
import { containerDeLinhas, linha } from "../lib/motion";
import { useListaPaginada } from "../hooks/use-lista-paginada";
import type { IndicadoresOrdens, ItemOrdem, MinhaOrdem, Periodo } from "../types";
import { DescricaoServico } from "./descricao-servico";
import { IndicadoresDeOrdens } from "./indicadores-ordens";
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

const COLUNAS = 8;
const LIMITE = 10;

/** Descreve o alvo da OS: veiculo, peca ou equipamento. */
function descreverAlvo(ordem: MinhaOrdem): string {
  if (ordem.veiculo) {
    const identificacao = [ordem.veiculo.marca, ordem.veiculo.modelo].filter(Boolean).join(" ");
    return [ordem.veiculo.placa, identificacao].filter(Boolean).join(" · ") || "Veículo";
  }
  return rotuloDeStatus(ordem.alvoTipo);
}

function BlocoDeItens({
  titulo,
  icone: Icone,
  itens,
  vazio,
}: {
  titulo: string;
  icone: LucideIcon;
  itens: ItemOrdem[];
  vazio: string;
}) {
  const total = itens.reduce((acc, item) => acc + item.subtotal, 0);

  return (
    <section className="min-w-0">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Icone className="size-3.5" aria-hidden />
        {titulo}
        <span className="font-normal normal-case">({itens.length})</span>
      </h3>

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <>
          <motion.ul className="grid gap-1.5" variants={containerDeLinhas} initial="oculto" animate="visivel">
            {itens.map((item) => (
              <motion.li
                key={`${titulo}-${item.id}`}
                variants={linha}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/60 pb-1.5 text-sm last:border-0 last:pb-0"
              >
                <DescricaoServico
                  descricao={item.descricao}
                  subdescricao={item.subdescricao}
                  identificador={item.referencia ?? item.codigo}
                  className="flex-1"
                />
                <span className="text-muted-foreground tabular-nums">
                  {formatarQuantidade(item.quantidade)}
                  {item.unidade ? ` ${item.unidade}` : ""} × {formatarMoeda(item.valorUnitario)}
                </span>
                <span className="ml-auto w-28 text-right font-medium tabular-nums">
                  {formatarMoeda(item.subtotal)}
                </span>
              </motion.li>
            ))}
          </motion.ul>

          <p className="mt-2 text-right text-xs text-muted-foreground">
            Subtotal: <span className="font-medium tabular-nums">{formatarMoeda(total)}</span>
          </p>
        </>
      )}
    </section>
  );
}

export function TabelaMinhasOrdens({ periodo, ativo, usuarioId }: { periodo: Periodo; ativo: boolean; usuarioId?: string }) {
  const [expandidas, setExpandidas] = useState<ReadonlySet<number>>(new Set());

  const buscar = useCallback(
    ({ page, limit, signal }: { page: number; limit: number; signal: AbortSignal }) =>
      buscarMinhasOrdens({ ...periodo, page, limit, signal, usuarioId }),
    [periodo, usuarioId],
  );

  const lista = useListaPaginada<MinhaOrdem>({
    buscar,
    limit: LIMITE,
    ativo,
    chaveDeReset: `${periodo.de}|${periodo.ate}|${usuarioId ?? "me"}`,
  });

  /*
   * Os totais cobrem o periodo inteiro, nao a pagina — por isso vivem em outro
   * endpoint e so sao buscados quando o periodo muda. Mesmo padrao de estado
   * derivado usado no resto da Central: a chave da consulta viaja junto com o
   * resultado, entao "carregando" nao precisa de setState dentro do efeito.
   */
  const chaveIndicadores = `${periodo.de}|${periodo.ate}|${usuarioId ?? "me"}`;
  const [estadoIndicadores, setEstadoIndicadores] = useState<{
    chave: string;
    dados: IndicadoresOrdens | null;
  }>({ chave: "", dados: null });
  const carregandoIndicadores = ativo && estadoIndicadores.chave !== chaveIndicadores;

  useEffect(() => {
    if (!ativo) return;

    const controller = new AbortController();

    buscarIndicadoresOrdens(periodo, usuarioId, controller.signal)
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
      <IndicadoresDeOrdens dados={estadoIndicadores.dados} carregando={carregandoIndicadores} />

      <CartaoTabela>
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead className="w-20">OS</TableHead>
            <TableHead className="w-28">Entrada</TableHead>
            <TableHead className="w-28">Finalizada</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead className="w-40">Alvo</TableHead>
            <TableHead className="w-36">Status</TableHead>
            <TableHead className="w-32 text-right">Total</TableHead>
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
              mensagem="Nenhuma ordem sua foi finalizada no período selecionado."
            />
          ) : (
            lista.items.map((ordem) => {
              const aberta = expandidas.has(ordem.id);

              return (
                <Fragment key={ordem.id}>
                  <LinhaAnimada>
                    <TableCell className="py-2">
                      <BotaoExpandir
                        aberto={aberta}
                        controla={`ordem-itens-${ordem.id}`}
                        rotulo={`${aberta ? "Ocultar" : "Mostrar"} itens da ordem ${ordem.id}`}
                        onClick={() => alternar(ordem.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">#{ordem.id}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatarData(ordem.dataEntrada)}
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {formatarData(ordem.concluidaEm)}
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate">
                      {ordem.cliente?.nome ?? "Sem cliente"}
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate text-muted-foreground">
                      {descreverAlvo(ordem)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={ordem.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatarMoeda(ordem.valorTotal)}
                    </TableCell>
                  </LinhaAnimada>

                  <AnimatePresence initial={false}>
                    {aberta && (
                      <LinhaDeDetalhe id={`ordem-itens-${ordem.id}`} colunas={COLUNAS}>
                        <div className="grid gap-6 lg:grid-cols-2">
                          <BlocoDeItens
                            titulo="Produtos"
                            icone={Package}
                            itens={ordem.produtos}
                            vazio="Nenhum produto lançado nesta OS."
                          />
                          <BlocoDeItens
                            titulo="Serviços"
                            icone={Wrench}
                            itens={ordem.servicos}
                            vazio="Nenhum serviço lançado nesta OS."
                          />
                        </div>
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
          rotuloItens={lista.total === 1 ? "ordem" : "ordens"}
          onMudarPagina={lista.irParaPagina}
        />
      </CartaoTabela>
    </div>
  );
}
