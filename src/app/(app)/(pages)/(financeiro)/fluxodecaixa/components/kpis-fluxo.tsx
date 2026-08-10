"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AnimatePresence, motion } from "motion/react";

import { Card, CardContent } from "@/components/ui/card";
import formatarEmReal from "@/utils/formatarEmReal";

import type { FluxoViewMode, TransactionRelationFilters } from "../types";

/**
 * Indicadores da aba aberta.
 *
 * Os números vêm do servidor já com o rótulo, porque a regra de cada visão é
 * dele: a tela não deveria saber que "A pagar" mostra vencido e "Fluxo" mostra
 * saldo. Trocar de aba troca a pergunta, não só o filtro.
 *
 * A animação é de troca de conteúdo, não de entrada: a `key` no viewMode faz o
 * conjunto sair e o novo entrar, o que dá a leitura de que os números mudaram de
 * assunto. Sem isso, valores trocando no lugar pareceriam correção de cálculo.
 */

type Kpi = { rotulo: string; valor: number; tom: "positivo" | "negativo" | "neutro" };

/**
 * Último resultado de cada consulta, fora do React.
 *
 * O componente desmonta ao trocar para Fluxo ou Liquidadas, e voltar depois
 * recomeçaria do zero — cartões vazios enquanto a consulta corre, que é o corte
 * que se quer eliminar. Guardando aqui, a volta é instantânea e a consulta só
 * confirma o que já está na tela.
 *
 * A chave é a consulta inteira, não só a aba: com período e filtros diferentes
 * os números são outros, e reaproveitar pela aba mostraria o total de um filtro
 * embaixo de outro.
 */
const ultimoResultado = new Map<string, Kpi[]>();

const COR: Record<Kpi["tom"], string> = {
  positivo: "text-emerald-600 dark:text-emerald-400",
  negativo: "text-destructive",
  neutro: "text-foreground",
};

export function KpisFluxo({
  viewMode,
  dateFrom,
  dateTo,
  search,
  relationFilters,
}: {
  viewMode: FluxoViewMode;
  dateFrom: string;
  dateTo: string;
  search: string;
  /** Os mesmos filtros da tabela: os cartões respondem pelo que está na tela. */
  relationFilters: TransactionRelationFilters;
}) {
  /**
   * O que está na tela e a que aba pertence, trocados **juntos**.
   *
   * Antes, a `key` da animação era o `viewMode`: a troca acontecia no clique e
   * os cartões apareciam vazios até a resposta chegar. Agora a aba muda, os
   * números antigos continuam visíveis, e a transição só roda quando os novos já
   * estão em mãos — o usuário nunca vê um cartão sem valor.
   */
  const { categoriaId, bancoId, planoContaId, centroCustoId, metodoPagamento } = relationFilters;

  // Primitivos, não o objeto: `relationFilters` pode vir recriado a cada render
  // do pai e refaria a consulta sem nada ter mudado.
  const consulta = useMemo(
    () => ({
      viewMode,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      search: search || undefined,
      categoriaId: categoriaId || undefined,
      bancoId: bancoId || undefined,
      planoContaId: planoContaId || undefined,
      centroCustoId: centroCustoId || undefined,
      metodopagamento: metodoPagamento || undefined,
    }),
    [
      viewMode,
      dateFrom,
      dateTo,
      search,
      categoriaId,
      bancoId,
      planoContaId,
      centroCustoId,
      metodoPagamento,
    ],
  );

  const chave = JSON.stringify(consulta);

  const [exibido, setExibido] = useState<{ viewMode: FluxoViewMode; kpis: Kpi[] } | null>(
    () => {
      const guardado = ultimoResultado.get(chave);
      return guardado ? { viewMode, kpis: guardado } : null;
    },
  );

  useEffect(() => {
    let ativo = true;

    axios
      .get("/api/transaction/kpis", { params: consulta })
      .then((r) => {
        // Só aqui a tela troca: dados e rótulo da aba entram no mesmo estado.
        const kpis: Kpi[] = r.data?.data?.kpis ?? [];
        ultimoResultado.set(chave, kpis);
        if (ativo) setExibido({ viewMode: consulta.viewMode, kpis });
      })
      .catch(() => {
        // Falha mantém o que estava: apagar os números por causa de uma consulta
        // que não voltou seria pior do que mostrá-los levemente desatualizados.
      });

    return () => {
      ativo = false;
    };
  }, [chave, consulta]);

  // Primeira carga: nada a preservar, então o espaço fica reservado em branco
  // para a tabela não pular quando os cartões chegarem.
  if (!exibido) return <div className="grid gap-4 sm:grid-cols-3 items-stretch" aria-hidden />;

  return (
    <div className="grid gap-4 sm:grid-cols-3 items-stretch">
      <AnimatePresence mode="wait">
        {/* A key é a aba **já carregada**, não a clicada. */}
        <motion.div
          key={exibido.viewMode}
          className="contents"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {exibido.kpis.map((kpi, indice) => {
            return (
              <motion.div
                key={kpi.rotulo}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                // Escalonado: os três entram em sequência, o que guia o olho da
                // esquerda para a direita em vez de piscar tudo de uma vez.
                transition={{ duration: 0.18, delay: indice * 0.04, ease: "easeOut" }}
              >
                <Card className="h-full py-4">
                  <CardContent className="flex h-full flex-col justify-center gap-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {kpi.rotulo}
                    </p>
                    <p className={`text-2xl font-semibold tabular-nums ${COR[kpi.tom]}`}>
                      {formatarEmReal(kpi.valor)}
                    </p>
                    {/* Linha de contexto: além de informar, iguala a altura à da
                        fileira de indicadores gerais, que tem três linhas. */}
                    <p className="text-xs text-muted-foreground">No período filtrado</p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
