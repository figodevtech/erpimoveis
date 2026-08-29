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
 *
 * Estes valores são COBRANÇA, não composição do total: `vOrig`, `vDesc`, `vLiq`
 * e `vDup` nunca entram no cálculo do `vNF`. Servem para contas a pagar,
 * parcelas e conferência financeira.
 */

import { comoLista, paraDia, paraNumero, paraTexto, registro } from "./xml-valores";

export interface DuplicataDaNota {
  /** `nDup`, só para exibir — o XML admite qualquer rótulo ("001", "A/1"). */
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
