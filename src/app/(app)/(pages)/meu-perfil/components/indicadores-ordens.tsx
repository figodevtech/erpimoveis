// src/app/(app)/(pages)/meu-perfil/components/indicadores-ordens.tsx
"use client";

import { Package, Percent, Sigma, Wrench } from "lucide-react";
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

const GRADE = "grid grid-cols-2 gap-2 xl:grid-cols-4";

export function IndicadoresDeOrdens({
  dados,
  carregando,
}: {
  dados: IndicadoresOrdens | null;
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
