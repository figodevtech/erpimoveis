// src/app/(app)/(pages)/meu-perfil/components/resumo-cards.tsx
"use client";

import type { LucideIcon } from "lucide-react";
import { ClipboardList, Hourglass, ShoppingCart, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatarMoeda } from "../lib/format";
import { MOLA, SAIDA, containerEscalonado, itemQueSobe } from "../lib/motion";
import type { MeuResumo } from "../types";
import { NumeroAnimado } from "./numero-animado";

type Cartao = {
  chave: string;
  rotulo: string;
  icone: LucideIcon;
  quantidade: number;
  valor: number | null;
  legenda: string | null;
  parcial: boolean;
  /** Cor do halo/icone — dá a cada métrica uma identidade reconhecível. */
  tom: string;
};

const inteiro = (valor: number) => String(Math.round(valor));

function montarCartoes(resumo: MeuResumo): Cartao[] {
  return [
    {
      chave: "vendas",
      rotulo: "Vendas realizadas",
      icone: ShoppingCart,
      quantidade: resumo.vendas.quantidade,
      valor: resumo.vendas.valor,
      legenda: null,
      parcial: resumo.vendas.parcial,
      tom: "text-emerald-600 dark:text-emerald-400",
    },
    {
      chave: "ordens",
      rotulo: "Ordens finalizadas",
      icone: ClipboardList,
      quantidade: resumo.ordens.quantidade,
      valor: resumo.ordens.valor,
      legenda: null,
      parcial: resumo.ordens.parcial,
      tom: "text-sky-600 dark:text-sky-400",
    },
    {
      chave: "servicos-finalizados",
      rotulo: "Serviços finalizados",
      icone: Wrench,
      quantidade: resumo.servicosFinalizados.quantidade,
      valor: resumo.servicosFinalizados.valor,
      legenda: null,
      parcial: resumo.servicosFinalizados.parcial,
      tom: "text-violet-600 dark:text-violet-400",
    },
    {
      chave: "servicos-andamento",
      rotulo: "Serviços em execução",
      icone: Hourglass,
      quantidade: resumo.servicosEmAndamento.quantidade,
      valor: null,
      legenda: "Iniciados e ainda não concluídos",
      parcial: resumo.servicosEmAndamento.parcial,
      tom: "text-amber-600 dark:text-amber-400",
    },
  ];
}

const GRADE = "grid gap-3 sm:grid-cols-2 xl:grid-cols-4";

export function ResumoCards({ resumo, carregando }: { resumo: MeuResumo | null; carregando: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {!resumo ? (
        <motion.div
          key="esqueleto"
          className={GRADE}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: SAIDA }}
        >
          {Array.from({ length: 4 }).map((_, indice) => (
            <Card key={indice}>
              <CardContent className="grid gap-2 p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
          ))}
        </motion.div>
      ) : (
        <motion.div
          key="cartoes"
          className={GRADE}
          variants={containerEscalonado}
          initial="oculto"
          animate="visivel"
          aria-busy={carregando}
        >
          {montarCartoes(resumo).map((cartao) => {
            const Icone = cartao.icone;

            return (
              <motion.div
                key={cartao.chave}
                variants={itemQueSobe}
                whileHover={{ y: -4 }}
                transition={MOLA}
              >
                <Card
                  className={cn(
                    "relative h-full overflow-hidden transition-[opacity,box-shadow] hover:shadow-md",
                    carregando && "opacity-60",
                  )}
                >
                  {/* Halo no tom da metrica: profundidade sem glassmorphism.
                      `bg-current` herda a cor de texto aplicada aqui. */}
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute -top-12 -right-12 size-32 rounded-full bg-current opacity-10 blur-2xl",
                      cartao.tom,
                    )}
                  />

                  <CardContent className="relative grid gap-1 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{cartao.rotulo}</span>
                      <Icone className={cn("size-4 shrink-0", cartao.tom)} aria-hidden />
                    </div>

                    <div className="flex items-baseline gap-2">
                      <NumeroAnimado
                        valor={cartao.quantidade}
                        formatar={inteiro}
                        className="text-2xl font-semibold tabular-nums"
                      />
                      {cartao.parcial && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-xs text-amber-600 dark:text-amber-400">
                              parcial
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Período muito grande: o valor somado considera apenas parte dos registros.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    {cartao.valor === null ? (
                      <span className="text-sm text-muted-foreground">{cartao.legenda}</span>
                    ) : (
                      <NumeroAnimado
                        valor={cartao.valor}
                        formatar={formatarMoeda}
                        className="text-sm text-muted-foreground tabular-nums"
                      />
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
