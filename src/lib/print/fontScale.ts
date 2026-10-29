export const PRINT_FONT_SCALES = [1, 1.1, 1.2] as const;

export type PrintFontScale = (typeof PRINT_FONT_SCALES)[number];

export const PRINT_DEFAULT_FONT_SCALE: PrintFontScale = PRINT_FONT_SCALES[0];
export const PRINT_MAX_FONT_SCALE: PrintFontScale = PRINT_FONT_SCALES.at(-1)!;
export const PRINT_FONT_SCALE_ATTRIBUTE = "data-print-font-scale";
export const PRINT_FONT_SCALE_PROPERTY = "--print-font-scale";
export const PRINT_FONT_SCALE_STORAGE_KEY = "erpimoveis:print-font-scale";

export function lerEscalaFonteImpressao(valor: string | null): PrintFontScale | null {
  if (valor === null) return null;

  const escala = Number(valor);
  return (PRINT_FONT_SCALES as readonly number[]).includes(escala)
    ? (escala as PrintFontScale)
    : null;
}

export function aumentarFonteImpressao(atual: PrintFontScale): PrintFontScale {
  const index = PRINT_FONT_SCALES.indexOf(atual);
  return PRINT_FONT_SCALES[
    Math.min(Math.max(index, 0) + 1, PRINT_FONT_SCALES.length - 1)
  ];
}

export function diminuirFonteImpressao(atual: PrintFontScale): PrintFontScale {
  const index = PRINT_FONT_SCALES.indexOf(atual);
  return PRINT_FONT_SCALES[Math.max(index - 1, 0)];
}

export function percentualFonteImpressao(escala: PrintFontScale) {
  return Math.round(escala * 100);
}
