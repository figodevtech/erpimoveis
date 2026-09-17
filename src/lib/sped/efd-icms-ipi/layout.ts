import { EFD_ICMS_IPI_LAYOUT_V020 } from "./layouts/v020/definitions";
import type { EfdLayout } from "./types";

export function resolveSpedLayout(competence: string): EfdLayout {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) {
    throw new Error("Competência deve estar no formato AAAA-MM.");
  }
  if (competence >= "2026-01" && competence <= "2026-12") {
    return EFD_ICMS_IPI_LAYOUT_V020;
  }
  throw new Error(`Não há leiaute EFD ICMS/IPI configurado para ${competence}.`);
}
