// src/app/(app)/(pages)/meu-perfil/components/abas-central.tsx
"use client";

import type { ReactNode } from "react";
import { ClipboardList, ShoppingCart, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { MOLA, MOLA_SUAVE } from "../lib/motion";
import type { AbaCentral } from "../types";

export const ABAS: Array<{ chave: AbaCentral; rotulo: string; icone: LucideIcon }> = [
  { chave: "vendas", rotulo: "Vendas", icone: ShoppingCart },
  { chave: "ordens", rotulo: "Ordens finalizadas", icone: ClipboardList },
  { chave: "servicos", rotulo: "Serviços realizados", icone: Wrench },
];

/** Distancia lateral de repouso de um painel inativo, em pixels. */
const DESLOCAMENTO = 28;

export function ListaDeAbas({ ativa }: { ativa: AbaCentral }) {
  return (
    <TabsList className="h-auto p-1">
      {ABAS.map((aba) => {
        const Icone = aba.icone;
        const selecionada = aba.chave === ativa;

        return (
          <TabsTrigger
            key={aba.chave}
            value={aba.chave}
            className={cn(
              "relative gap-1.5 px-3 py-1.5",
              // O realce fica por conta da pilula animada abaixo.
              "data-[state=active]:border-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none",
              "dark:data-[state=active]:bg-transparent",
            )}
          >
            {selecionada && (
              <motion.span
                layoutId="aba-central-ativa"
                aria-hidden
                className="absolute inset-0 rounded-md border border-border bg-background shadow-sm dark:border-transparent dark:bg-accent"
                transition={MOLA}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Icone className="size-4" aria-hidden />
              {aba.rotulo}
            </span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

/**
 * Painel de aba que desliza a partir do lado onde ele "mora" na barra: a aba a
 * direita entra pela direita, a da esquerda pela esquerda.
 *
 * Os tres paineis ficam montados (`forceMount`) para preservar a pagina aberta
 * em cada tabela; os inativos ficam com `display:none` via CSS, e por isso o
 * repouso deles ja e a posicao deslocada — quando reaparecem, a mola so precisa
 * trazer de volta ao centro.
 */
export function PainelDeAba({
  chave,
  ativa,
  children,
}: {
  chave: AbaCentral;
  ativa: AbaCentral;
  children: ReactNode;
}) {
  const distancia = ABAS.findIndex((a) => a.chave === chave) - ABAS.findIndex((a) => a.chave === ativa);
  const selecionada = distancia === 0;

  return (
    <TabsContent forceMount value={chave} className="mt-4 data-[state=inactive]:hidden">
      <motion.div
        initial={false}
        animate={
          selecionada
            ? { opacity: 1, x: 0, scale: 1 }
            : { opacity: 0, x: Math.sign(distancia) * DESLOCAMENTO, scale: 0.99 }
        }
        transition={MOLA_SUAVE}
      >
        {children}
      </motion.div>
    </TabsContent>
  );
}
