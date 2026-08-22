export const DANFE_FONT_SCALES = [1, 1.1, 1.2] as const;

export type DanfeFontScale = (typeof DANFE_FONT_SCALES)[number];

export const DANFE_DEFAULT_FONT_SCALE: DanfeFontScale = DANFE_FONT_SCALES[0];
export const DANFE_MAX_FONT_SCALE: DanfeFontScale = DANFE_FONT_SCALES.at(-1)!;

export function aumentarFonteDanfe(atual: DanfeFontScale): DanfeFontScale {
  const index = DANFE_FONT_SCALES.indexOf(atual);
  return DANFE_FONT_SCALES[Math.min(Math.max(index, 0) + 1, DANFE_FONT_SCALES.length - 1)];
}

export function diminuirFonteDanfe(atual: DanfeFontScale): DanfeFontScale {
  const index = DANFE_FONT_SCALES.indexOf(atual);
  return DANFE_FONT_SCALES[Math.max(index - 1, 0)];
}

export function percentualFonteDanfe(escala: DanfeFontScale) {
  return Math.round(escala * 100);
}
