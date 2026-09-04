// src/app/(app)/(pages)/meu-perfil/components/indicadores-ordens.tsx
"use client";

import { HandCoins, Package, Percent, Sigma, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatarMoeda } from "../lib/format";
import { containerDeLinhas, linha } from "../lib/motion";
import type { IndicadoresOrdens } from "../types";
import { NumeroAnimado } from "./numero-animado";

type Tile = {
  chave: string;
  rotulo: string;
  icone: LucideIcon;
  valor: number;
  tom: string;
  nota?: string;
};

function montar(dados: IndicadoresOrdens): Tile[] {
  return [
    // Só aparece para quem de fato recebe por criação. Um tile de R$ 0,00 na
    // tela de todo mundo que abre OS sugeriria um pagamento que não existe —
    // mesma razão pela qual o badge "Comissão" só marca o caso positivo.
    ...(dados.comissaoCriacao > 0
      ? [
          {
            chave: "comissao-criacao",
            rotulo: "Comissão por criação",
            icone: HandCoins,
            valor: dados.comissaoCriacao,
            tom: "text-emerald-600 dark:text-emerald-400",
            nota: "O que você recebe por ter aberto estas ordens, sobre os serviços e produtos delas — independente de quem executou. Sai do valor já com o desconto da OS.",
          } satisfies Tile,
        ]
      : []),
    {
      chave: "produtos",
      rotulo: "Produtos",
      icone: Package,
      valor: dados.produtos,
      tom: "text-sky-600 dark:text-sky-400",
    },
    {
      chave: "servicos",
      rotulo: "Serviços",
      icone: Wrench,
      valor: dados.servicos,
      tom: "text-violet-600 dark:text-violet-400",
    },
    {
      chave: "servicos-comissao",
      rotulo: "Serviços com comissão",
      icone: Percent,
      valor: dados.servicosComComissao,
      tom: "text-emerald-600 dark:text-emerald-400",
      nota: "Considera apenas serviços marcados como “Gera comissão” no cadastro.",
    },
    {
      chave: "total",
      rotulo: "Total das OS",
      icone: Sigma,
      valor: dados.total,
      tom: "text-amber-600 dark:text-amber-400",
      nota: "Valor fechado da OS: já embute desconto e acréscimo, por isso pode diferir da soma de produtos + serviços.",
    },
  ];
}

/** Cinco tiles quando ha comissao de criacao; quatro no caso comum. */
const grade = (tiles: number) =>
  `grid grid-cols-2 gap-2 ${tiles > 4 ? "xl:grid-cols-5" : "xl:grid-cols-4"}`;

export function IndicadoresDeOrdens({
  dados,
  carregando,
}: {
  dados: IndicadoresOrdens | null;
  carregando: boolean;
}) {
  if (!dados) {
    return (
      <div className={grade(4)}>
        {Array.from({ length: 4 }).map((_, indice) => (
          <div key={indice} className="rounded-lg border bg-card p-3">
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    );
  }

  const tiles = montar(dados);

  return (
    <motion.div
      className={grade(tiles.length)}
      variants={containerDeLinhas}
      initial="oculto"
      animate="visivel"
      aria-busy={carregando}
    >
      {tiles.map((tile) => {
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
              formatar={formatarMoeda}
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
