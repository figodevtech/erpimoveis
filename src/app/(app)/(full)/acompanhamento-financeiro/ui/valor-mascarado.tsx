"use client";

import type { ReactNode } from "react";

/**
 * Alterna entre o conteúdo real e um traço. O valor "fecha" como uma cortina:
 * topo e base avançam ao mesmo tempo (via clip-path) até se encontrarem no meio,
 * onde o traço aparece. Ao reabrir, o traço some e o valor se abre a partir do
 * centro. Sai (fica oculto) com ease-in; entra (fica visível) com ease-out.
 */
export default function ValorMascarado({
  oculto,
  className,
  children,
}: {
  oculto: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`relative inline-grid align-baseline ${className ?? ""}`}>
      <span
        aria-hidden={oculto}
        className={`col-start-1 row-start-1 transition-all duration-300 ${
          oculto
            ? "pointer-events-none opacity-0 ease-in select-none [clip-path:inset(50%_0_50%_0)]"
            : "opacity-100 ease-out [clip-path:inset(0_0_0_0)]"
        }`}
      >
        {children}
      </span>
      <span
        aria-hidden={!oculto}
        className={`col-start-1 row-start-1 flex items-center transition-opacity duration-300 ${
          oculto ? "opacity-100 ease-out delay-150" : "pointer-events-none opacity-0 ease-in"
        }`}
      >
        <span className="inline-block h-[0.12em] w-full min-w-6 rounded-full bg-current opacity-40" />
      </span>
    </span>
  );
}
