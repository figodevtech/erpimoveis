// src/app/(app)/(full)/print/layout.tsx
import type { ReactNode } from "react";

import { UiScaleOff } from "@/components/ui-scale-off";

/**
 * As telas de impressao ficam fora da escala global da interface
 * (ver --app-ui-scale em globals.css): a geometria delas e calibrada em mm
 * e a paginacao A4 e medida na tela antes de mandar para a impressora.
 */
export default function PrintScaleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <UiScaleOff />
      {children}
    </>
  );
}
