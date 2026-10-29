// src/app/(app)/(pages)/meu-perfil/components/abas-central.tsx
"use client";

import type { ReactNode } from "react";
import { ShoppingCart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MOLA_SUAVE } from "../lib/motion";
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
];

/** Distancia lateral de repouso de um painel inativo, em pixels. */
const DESLOCAMENTO = 28;

export function ListaDeAbas() {
  return (
    // No celular a barra ocupa a linha inteira e divide o espaco entre as tres
    // abas; a partir de `sm` ela volta a ter a largura do conteudo.
    <TabsList className="h-auto w-full justify-start gap-1.5 rounded-xl border bg-muted/40 p-1 sm:w-fit">
      {ABAS.map((aba) => {
        const Icone = aba.icone;
        return (
          <TabsTrigger
            key={aba.chave}
            value={aba.chave}
            className="group h-8 min-w-0 flex-1 rounded-xl border border-transparent px-2 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground sm:flex-none sm:px-3"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Icone className="size-3.5 shrink-0 transition-transform group-data-[state=active]:scale-105" aria-hidden />
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
