"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * O tooltip do Radix não abre no toque: ele responde a hover e foco, e o
 * pointerdown do próprio toque fecha na hora — no celular o texto piscava e
 * sumia. Onde não há hover, a dica vira popover: abre no toque e só fecha ao
 * tocar fora. Onde há mouse, segue tooltip.
 */
function useTelaDeToque() {
  // Começa em toque: o popover funciona nos dois mundos, então o primeiro
  // render nunca fica com o comportamento quebrado enquanto o efeito não roda.
  const [toque, setToque] = React.useState(true);

  React.useEffect(() => {
    const consulta = window.matchMedia("(hover: hover) and (pointer: fine)");
    const aplicar = () => setToque(!consulta.matches);
    aplicar();
    consulta.addEventListener("change", aplicar);
    return () => consulta.removeEventListener("change", aplicar);
  }, []);

  return toque;
}

export type DicaProps = {
  /** O que fica visível: o rótulo do KPI ou o título do gráfico. */
  children: React.ReactNode;
  /** Usado só no rótulo acessível do botão. */
  rotulo: string;
  conteudo: React.ReactNode;
  className?: string;
};

export default function Dica({ children, rotulo, conteudo, className }: DicaProps) {
  const toque = useTelaDeToque();

  const gatilho = (
    <button
      type="button"
      aria-label={`Como "${rotulo}" é calculado`}
      className={cn(
        "flex min-w-0 items-start gap-1 text-left hover:cursor-help",
        "focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
      <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </button>
  );

  if (toque) {
    return (
      <Popover>
        <PopoverTrigger asChild>{gatilho}</PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          collisionPadding={12}
          // Sem isto o popover rouba o foco ao abrir e a tela pula no celular.
          onOpenAutoFocus={(evento) => evento.preventDefault()}
          className="w-auto max-w-[min(18rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed"
        >
          {conteudo}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{gatilho}</TooltipTrigger>
      <TooltipContent side="top" collisionPadding={12} className="max-w-72 text-xs leading-relaxed">
        {conteudo}
      </TooltipContent>
    </Tooltip>
  );
}
