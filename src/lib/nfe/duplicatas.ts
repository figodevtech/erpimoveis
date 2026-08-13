/**
 * Cobrança da NF-e: a fatura e as duplicatas do grupo `cobr`.
 *
 * É o parcelamento que o fornecedor já emitiu — número, vencimento e valor de
 * cada título. A entrada por nota fiscal ignorava esse grupo e obrigava a digitar
 * de novo, à mão, o que já estava no XML.
 *
 * Trabalha sobre o objeto do `fast-xml-parser` (o formato que a rota de entrada
 * usa), não sobre DOM — `danfeParser` lê os mesmos campos a partir do XML cru
 * para a DANFE. Os nomes de saída são os mesmos dos dois lados de propósito.
 */

export interface DuplicataDaNota {
  /**
   * `nDup`, só para exibir. Texto porque o XML admite qualquer rótulo ("001",
   * "A/1"), mas sem promessa de fidelidade: o `fast-xml-parser` da rota converte
   * "012345" em número e o zero à esquerda se perde no caminho. Nada depende
   * deste campo — a parcela é vencimento e valor.
   */
  numero: string | null;
  /** `dVenc` normalizado em AAAA-MM-DD, ou `null` quando o XML não trouxe. */
  vencimento: string | null;
  /** `vDup` em reais. */
  valor: number;
}

export interface FaturaDaNota {
  numero: string | null;
  valorOriginal: number | null;
  desconto: number | null;
  valorLiquido: number | null;
}

export interface CobrancaDaNota {
  fatura: FaturaDaNota | null;
  duplicatas: DuplicataDaNota[];
}

/**
 * O `fast-xml-parser` converte o que parece número em número, então o mesmo campo
 * chega ora como `119`, ora como `"119,00"` (emitente que usa vírgula). Os dois
 * precisam virar o mesmo `119`.
 */
function paraNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;

  const limpo = valor.trim().replace(",", ".");
  if (!limpo) return null;

  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : null;
}

function paraTexto(valor: unknown): string | null {
  if (valor == null) return null;
  const texto = String(valor).trim();
  return texto || null;
}

/**
 * `dVenc` é data pura (AAAA-MM-DD) na especificação, mas aparece com hora colada
 * em emissor que reaproveita campo de timestamp. Cortar em 10 evita que o
 * vencimento ande um dia ao virar `Date` no fuso do navegador.
 */
function paraDia(valor: unknown): string | null {
  const texto = paraTexto(valor);
  if (!texto) return null;

  const encontrado = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  return encontrado ? encontrado[0].slice(0, 10) : null;
}

/** Um nó do fast-xml-parser vira lista: filho único não vem em array. */
function comoLista(valor: unknown): unknown[] {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function registro(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

export function extrairCobranca(infNFe: unknown): CobrancaDaNota {
  const cobr = registro(registro(infNFe)?.cobr);
  if (!cobr) return { fatura: null, duplicatas: [] };

  const fat = registro(cobr.fat);

  const duplicatas = comoLista(cobr.dup)
    .map((item) => {
      const dup = registro(item);
      if (!dup) return null;

      return {
        numero: paraTexto(dup.nDup),
        vencimento: paraDia(dup.dVenc),
        valor: paraNumero(dup.vDup) ?? 0,
      };
    })
    .filter((dup): dup is DuplicataDaNota => dup != null)
    // Título sem valor não vira parcela: entraria como R$ 0,00 e travaria o
    // lançamento na validação de valor positivo.
    .filter((dup) => dup.valor > 0);

  return {
    fatura: fat
      ? {
          numero: paraTexto(fat.nFat),
          valorOriginal: paraNumero(fat.vOrig),
          desconto: paraNumero(fat.vDesc),
          valorLiquido: paraNumero(fat.vLiq),
        }
      : null,
    duplicatas,
  };
}

/** Soma das duplicatas em centavos — a comparação com o valor a destinar. */
export function totalDasDuplicatas(duplicatas: DuplicataDaNota[]): number {
  return duplicatas.reduce(
    (total, duplicata) => total + Math.round(duplicata.valor * 100),
    0,
  );
}
