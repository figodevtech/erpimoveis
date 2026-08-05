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

/**
 * `rotuloCurto` existe so por causa do celular: os tres rotulos completos somam
 * mais que a largura de uma tela de 360px e faziam a barra estourar a pagina.
 */
export const ABAS: Array<{
  chave: AbaCentral;
  rotulo: string;
  rotuloCurto: string;
  icone: LucideIcon;
}> = [
  { chave: "vendas", rotulo: "Vendas", rotuloCurto: "Vendas", icone: ShoppingCart },
  { chave: "ordens", rotulo: "Ordens finalizadas", rotuloCurto: "Ordens", icone: ClipboardList },
  { chave: "servicos", rotulo: "Serviços realizados", rotuloCurto: "Serviços", icone: Wrench },
];

/** Distancia lateral de repouso de um painel inativo, em pixels. */
const DESLOCAMENTO = 28;

export function ListaDeAbas({ ativa }: { ativa: AbaCentral }) {
  return (
    // No celular a barra ocupa a linha inteira e divide o espaco entre as tres
    // abas; a partir de `sm` ela volta a ter a largura do conteudo.
    <TabsList className="h-auto w-full justify-start p-1 sm:w-fit">
      {ABAS.map((aba) => {
        const Icone = aba.icone;
        const selecionada = aba.chave === ativa;

        return (
          <TabsTrigger
            key={aba.chave}
            value={aba.chave}
            className={cn(
              "relative min-w-0 flex-1 gap-1.5 px-2 py-1.5 sm:flex-none sm:px-3",
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
            <span className="relative flex min-w-0 items-center gap-1.5">
              <Icone className="size-4 shrink-0" aria-hidden />
              <span className="truncate sm:hidden">{aba.rotuloCurto}</span>
              <span className="hidden truncate sm:inline">{aba.rotulo}</span>
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
