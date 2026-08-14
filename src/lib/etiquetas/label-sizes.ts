/**
 * Tamanhos de etiqueta que o sistema emite e como o conteudo se acomoda em cada
 * um. O preset e a fonte unica dessa decisao: as rotas de impressao so leem daqui,
 * entao mudar o layout de uma etiqueta e mudar uma linha desta tabela.
 */

export type LabelSizeKey = "50x30" | "60x30" | "60x40" | "80x40" | "100x50";

export type LabelSize = {
  label: string;
  widthMm: number;
  heightMm: number;
};

export type LabelPreset = LabelSize & {
  /** "stack": QR sobre o texto (etiqueta baixa). "side": QR a esquerda do texto. */
  layout: "stack" | "side";
  /** Lado do QR impresso, em mm. */
  qrMm: number;
  /**
   * Tamanhos de fonte em pt. O titulo comeca em `titulo` e encolhe ate caber
   * inteiro, com `tituloMin` de piso — abaixo disso a etiqueta fica ilegivel e
   * e melhor cortar com reticencias do que imprimir o que ninguem le.
   */
  fonts: { titulo: number; tituloMin: number; referencia: number };
};

export const LABEL_PRESETS: Record<LabelSizeKey, LabelPreset> = {
  "50x30": {
    label: "50 x 30 mm",
    widthMm: 50,
    heightMm: 30,
    layout: "stack",
    qrMm: 14,
    fonts: { titulo: 6.5, tituloMin: 4, referencia: 5 },
  },
  "60x30": {
    label: "60 x 30 mm",
    widthMm: 60,
    heightMm: 30,
    layout: "side",
    qrMm: 16,
    fonts: { titulo: 7, tituloMin: 4.5, referencia: 5.5 },
  },
  "60x40": {
    label: "60 x 40 mm",
    widthMm: 60,
    heightMm: 40,
    layout: "side",
    qrMm: 18,
    fonts: { titulo: 8, tituloMin: 4.5, referencia: 6 },
  },
  "80x40": {
    label: "80 x 40 mm",
    widthMm: 80,
    heightMm: 40,
    layout: "side",
    qrMm: 20,
    fonts: { titulo: 9.5, tituloMin: 5, referencia: 7 },
  },
  "100x50": {
    label: "100 x 50 mm",
    widthMm: 100,
    heightMm: 50,
    layout: "side",
    qrMm: 26,
    fonts: { titulo: 12, tituloMin: 6, referencia: 8.5 },
  },
};

/** Somente as medidas, para quem imprime etiqueta de codigo avulso. */
export const LABEL_SIZES: Record<LabelSizeKey, LabelSize> = Object.fromEntries(
  Object.entries(LABEL_PRESETS).map(([key, preset]) => [
    key,
    { label: preset.label, widthMm: preset.widthMm, heightMm: preset.heightMm },
  ]),
) as Record<LabelSizeKey, LabelSize>;

export const LABEL_SIZE_KEYS = Object.keys(LABEL_PRESETS) as LabelSizeKey[];

export const DEFAULT_LABEL_SIZE: LabelSizeKey = "60x40";

export function isLabelSizeKey(value: unknown): value is LabelSizeKey {
  return typeof value === "string" && value in LABEL_PRESETS;
}

/**
 * O campo `referencia` do produto guarda uma lista: o TagInput do cadastro grava
 * as tags unidas por espaco. Virgula tambem quebra aqui porque cadastro antigo
 * pode ter entrado com ela — nenhuma referencia isolada contem os dois.
 */
export function parseReferencias(referencia?: string | null): string[] {
  return String(referencia ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
