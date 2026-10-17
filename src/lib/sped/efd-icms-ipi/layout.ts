import { EFD_ICMS_IPI_LAYOUT_V020 } from "./layouts/v020/definitions";
import type { EfdLayout } from "./types";

/**
 * Leiautes conhecidos pelo motor, cada um com a vigência do Ato COTEPE que o
 * publicou. A EFD de uma competência usa o leiaute vigente no primeiro dia dela.
 *
 * Para incluir um exercício novo, crie as definições em `layouts/vNNN` a partir
 * do Ato COTEPE e do Guia Prático do ano. Estender a vigência de um leiaute
 * existente produziria um arquivo com `COD_VER` errado, que o PVA recusa.
 */
export const SPED_LAYOUT_REGISTRY: readonly EfdLayout[] = [EFD_ICMS_IPI_LAYOUT_V020];

const COMPETENCE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class SpedLayoutNotConfiguredError extends Error {
  readonly code = "LEIAUTE_NAO_CONFIGURADO";

  constructor(readonly competence: string) {
    super(
      `Não há leiaute EFD ICMS/IPI configurado para ${competence}. `
      + "O motor só gera competências cobertas por um leiaute oficial cadastrado.",
    );
    this.name = "SpedLayoutNotConfiguredError";
  }
}

export function findSpedLayout(competence: string, registry: readonly EfdLayout[] = SPED_LAYOUT_REGISTRY): EfdLayout | null {
  if (!COMPETENCE_PATTERN.test(competence)) {
    throw new Error("Competência deve estar no formato AAAA-MM.");
  }
  const firstDay = `${competence}-01`;
  return registry.find((layout) => layout.validFrom <= firstDay && firstDay <= layout.validUntil) ?? null;
}

export function resolveSpedLayout(competence: string, registry: readonly EfdLayout[] = SPED_LAYOUT_REGISTRY): EfdLayout {
  const layout = findSpedLayout(competence, registry);
  if (!layout) throw new SpedLayoutNotConfiguredError(competence);
  return layout;
}

/**
 * Leiaute de uma versão já registrada. Uma versão fechada carrega o código do
 * leiaute com que foi montada; regerar o TXT com outro código mudaria o arquivo.
 */
export function resolveSpedLayoutForVersion(
  competence: string,
  versionLayoutCode: string | null | undefined,
  registry: readonly EfdLayout[] = SPED_LAYOUT_REGISTRY,
): EfdLayout {
  const expected = resolveSpedLayout(competence, registry);
  const code = String(versionLayoutCode ?? "").trim();
  if (code && code !== expected.code) {
    throw new Error(
      `A versão foi montada com o leiaute ${code}, mas a competência ${competence} exige o leiaute ${expected.code}.`,
    );
  }
  return expected;
}
