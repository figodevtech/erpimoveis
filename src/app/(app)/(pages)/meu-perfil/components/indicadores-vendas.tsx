// src/app/(app)/(pages)/meu-perfil/components/indicadores-vendas.tsx
"use client";

import { Package, Sigma, TicketPercent, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatarMoeda } from "../lib/format";
import { containerDeLinhas, linha } from "../lib/motion";
import type { IndicadoresVendas } from "../types";
import { NumeroAnimado } from "./numero-animado";

/**
 * Composição do valor das vendas do período.
 *
 * Existe pelo mesmo motivo dos cards da aba de ordens, e com o mesmo desenho.
 * A diferença é o que eles respondem: a soma dos produtos vendidos não é o
 * valor das vendas quando há frete ou desconto no meio, e quem vende precisa
 * ver as parcelas separadas para saber sobre o que ganha.
 *
 * A ordem é a da conta, da esquerda para a direita: produtos, o que abate, o
 * que soma, e o resultado.
 */

type Tile = {
  chave: string;
  rotulo: string;
  icone: LucideIcon;
  valor: number;
  tom: string;
  nota?: string;
};

function montar(dados: IndicadoresVendas): Tile[] {
  return [
    { chave: "comissao", rotulo: "Comissão apurada", icone: TicketPercent,
      valor: dados.comissao ?? 0, tom: "text-violet-600 dark:text-violet-400",
      nota: "Valor registrado para o vendedor. A comissão apurada ainda pode estar aguardando lançamento ou pagamento pelo financeiro." },
    {
      chave: "produtos",
      rotulo: "Produtos",
      icone: Package,
      valor: dados.produtos,
      tom: "text-sky-600 dark:text-sky-400",
      nota: "Soma dos itens vendidos, antes de desconto e frete.",
    },
    {
      chave: "descontos",
      rotulo: "Descontos",
      icone: TicketPercent,
      valor: dados.descontos,
      tom: "text-rose-600 dark:text-rose-400",
      nota: "Desconto concedido no fechamento da venda. Abate do total e, com ele, da base de comissão.",
    },
    {
      chave: "frete",
      rotulo: "Frete",
      icone: Truck,
      valor: dados.frete,
      tom: "text-amber-600 dark:text-amber-400",
      nota: "Cobrado do cliente e somado ao total. É repasse de transporte, não venda de produto: fica fora da base de comissão.",
    },
    {
      chave: "total",
      rotulo: "Total das vendas",
      icone: Sigma,
      valor: dados.total,
      tom: "text-emerald-600 dark:text-emerald-400",
      nota: "Valor fechado das vendas: produtos − descontos + frete. Por isso pode diferir da soma dos produtos. A comissão incide sobre este valor menos o frete.",
    },
  ];
}

const GRADE = "grid grid-cols-2 gap-2 xl:grid-cols-5";

export function IndicadoresDeVendas({
  dados,
  carregando,
}: {
  dados: IndicadoresVendas | null;
  carregando: boolean;
}) {
  if (!dados) {
    return (
      <div className={GRADE}>
        {Array.from({ length: 5 }).map((_, indice) => (
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
