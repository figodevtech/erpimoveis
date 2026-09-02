// src/app/(app)/(pages)/meu-perfil/components/indicadores-servicos.tsx
"use client";

import { BadgeDollarSign, Percent, Sigma, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatarMoeda } from "../lib/format";
import { containerDeLinhas, linha } from "../lib/motion";
import type { IndicadoresServicos } from "../types";
import { NumeroAnimado } from "./numero-animado";

/**
 * Totais da aba de serviços realizados.
 *
 * Mesmo desenho dos cards das outras abas. A diferença é o primeiro tile, que
 * conta serviços em vez de somar reais — daí cada tile carregar o próprio
 * formatador.
 */

type Tile = {
  chave: string;
  rotulo: string;
  icone: LucideIcon;
  valor: number;
  tom: string;
  formatar: (valor: number) => string;
  nota?: string;
};

const inteiro = (valor: number) => String(Math.round(valor));

function montar(dados: IndicadoresServicos): Tile[] {
  return [
    {
      chave: "servicos",
      rotulo: "Serviços realizados",
      icone: Wrench,
      valor: dados.servicos,
      tom: "text-violet-600 dark:text-violet-400",
      formatar: inteiro,
      nota: "Serviços executados por você em OS encerradas no período.",
    },
    {
      chave: "valor",
      rotulo: "Valor dos serviços",
      icone: Sigma,
      valor: dados.valorTotal,
      tom: "text-sky-600 dark:text-sky-400",
      formatar: formatarMoeda,
      nota: "Soma do valor dos serviços executados por você, como aparece na coluna “Valor” da lista.",
    },
    {
      chave: "com-comissao",
      rotulo: "Gera comissão",
      icone: Percent,
      valor: dados.valorComComissao,
      tom: "text-emerald-600 dark:text-emerald-400",
      formatar: formatarMoeda,
      nota: "Quanto do valor acima vem de serviços marcados como “Gera comissão” no cadastro.",
    },
    {
      chave: "comissao",
      rotulo: "Sua comissão",
      icone: BadgeDollarSign,
      valor: dados.comissao,
      tom: "text-amber-600 dark:text-amber-400",
      formatar: formatarMoeda,
      nota: "Soma da comissão gravada em cada serviço do período. Em serviço dividido entra só a sua parte — por isso não é uma porcentagem exata do valor ao lado.",
    },
  ];
}

const GRADE = "grid grid-cols-2 gap-2 xl:grid-cols-4";

export function IndicadoresDeServicos({
  dados,
  carregando,
}: {
  dados: IndicadoresServicos | null;
  carregando: boolean;
}) {
  if (!dados) {
    return (
      <div className={GRADE}>
        {Array.from({ length: 4 }).map((_, indice) => (
          <div key={indice} className="rounded-lg border bg-card p-3">
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <motion.div
      className={GRADE}
      variants={containerDeLinhas}
      initial="oculto"
      animate="visivel"
      aria-busy={carregando}
    >
      {montar(dados).map((tile) => {
        const Icone = tile.icone;

        const conteudo = (
          <div
            className={cn(
              "rounded-lg border bg-card p-3 transition-opacity",
              carregando && "opacity-60",
            )}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icone className={cn("size-3.5 shrink-0", tile.tom)} aria-hidden />
              <span className="truncate">{tile.rotulo}</span>
              {tile.nota && <span aria-hidden className="text-muted-foreground/60">*</span>}
            </div>
            <NumeroAnimado
              valor={tile.valor}
              formatar={tile.formatar}
              className="mt-0.5 block truncate text-base font-semibold tabular-nums sm:text-lg"
            />
          </div>
        );

        return (
          <motion.div key={tile.chave} variants={linha}>
            {tile.nota ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">{conteudo}</div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{tile.nota}</TooltipContent>
              </Tooltip>
            ) : (
              conteudo
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
