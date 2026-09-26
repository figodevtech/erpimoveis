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

/** Entrada fiscal para a emissão. Vencimento é uma data civil, sem conversão de fuso. */
export type NFeDuplicataInput = {
  numero?: string | null;
  vencimento: string;
  valor: string | number;
};

export type NFeCobrancaInput = { duplicatas: NFeDuplicataInput[] };

export type NFeDuplicataNormalizada = { numero: string; vencimento: string; valor: number };
export type NFeCobrancaNormalizada = { duplicatas: NFeDuplicataNormalizada[]; totalCentavos: number };

export const MAX_DUPLICATAS_NFE = 120;

export function numeroDaDuplicata(index: number): string {
  return String(index + 1).padStart(3, "0");
}

export function centavosDaDuplicata(valor: string | number | null | undefined): number {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round(numero * 100) : NaN;
}

/** Retorna centavos inteiros; o resto é distribuído a partir da primeira parcela. */
export function distribuirDuplicatasIgualmente(valorTotal: string | number, quantidade: number): number[] {
  const totalCentavos = centavosDaDuplicata(valorTotal);
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos < 0 ||
    !Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_DUPLICATAS_NFE) {
    throw new RangeError("Valor ou quantidade de duplicatas inválido.");
  }
  if (totalCentavos < quantidade) {
    throw new RangeError("Cada duplicata precisa receber pelo menos R$ 0,01.");
  }
  const base = Math.floor(totalCentavos / quantidade);
  const resto = totalCentavos % quantidade;
  return Array.from({ length: quantidade }, (_, index) => base + (index < resto ? 1 : 0));
}

export function dividirDuplicatasIgualmente(
  duplicatas: NFeDuplicataInput[], valorTotal: string | number,
): NFeDuplicataInput[] {
  if (!duplicatas.length) return duplicatas;
  const valores = distribuirDuplicatasIgualmente(valorTotal, duplicatas.length);
  return duplicatas.map((duplicata, index) => ({
    ...duplicata,
    numero: numeroDaDuplicata(index),
    valor: valores[index] / 100,
  }));
}

function dataCivilValida(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [ano, mes, dia] = value.split("-").map(Number);
  if (ano < 1 || mes < 1 || mes > 12) return false;
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  const diasNoMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dia >= 1 && dia <= diasNoMes[mes - 1];
}

export function resolverCobrancaNFe(params: {
  modelo: number;
  finNFe: number;
  pagamentos: Array<{ tPag: string; valor?: string | number | null }>;
  cobranca?: NFeCobrancaInput | null;
  valorNota: string | number;
}): { cobranca: NFeCobrancaNormalizada | null; erros: string[] } {
  const errors: string[] = [];
  const duplicatas = Array.isArray(params.cobranca?.duplicatas) ? params.cobranca.duplicatas : [];
  const pagamento14 = params.pagamentos.filter((pagamento) => pagamento.tPag === "14");
  if (params.modelo === 65 && (pagamento14.length || duplicatas.length)) {
    errors.push("Duplicata Mercantil não é permitida na NFC-e.");
  }
  if ([3, 4].includes(params.finNFe) && (pagamento14.length || duplicatas.length)) {
    errors.push("Duplicata Mercantil não é permitida para esta finalidade da NF-e.");
  }
  if (pagamento14.length && !duplicatas.length) {
    errors.push("Duplicata Mercantil exige ao menos uma duplicata com vencimento e valor.");
  }
  if (duplicatas.length && !pagamento14.length) {
    errors.push("O grupo de duplicatas só pode ser informado quando a forma de pagamento Duplicata Mercantil estiver presente.");
  }
  if (duplicatas.length > MAX_DUPLICATAS_NFE) {
    errors.push(`Informe no máximo ${MAX_DUPLICATAS_NFE} duplicatas.`);
  }
  if (pagamento14.length > 1) errors.push("Informe Duplicata Mercantil apenas uma vez.");

  let anterior = "";
  const normalizadas = duplicatas.map((duplicata, index): NFeDuplicataNormalizada => {
    const numero = numeroDaDuplicata(index);
    const vencimento = String(duplicata?.vencimento ?? "").trim();
    const centavos = centavosDaDuplicata(duplicata?.valor);
    if (!vencimento) errors.push(`Informe o vencimento da duplicata ${numero}.`);
    else if (!dataCivilValida(vencimento)) errors.push(`Informe uma data válida (YYYY-MM-DD) para a duplicata ${numero}.`);
    else if (anterior && vencimento < anterior) errors.push(`O vencimento da duplicata ${numero} não pode ser anterior ao vencimento da duplicata ${numeroDaDuplicata(index - 1)}.`);
    if (dataCivilValida(vencimento)) anterior = vencimento;
    if (!Number.isFinite(centavos) || centavos <= 0) errors.push(`Informe um valor maior que zero para a duplicata ${numero}.`);
    return { numero, vencimento, valor: Number.isFinite(centavos) ? centavos / 100 : 0 };
  });
  const totalCentavos = normalizadas.reduce((sum, duplicata) => sum + centavosDaDuplicata(duplicata.valor), 0);
  if (pagamento14.length === 1 && duplicatas.length) {
    const informado = pagamento14[0].valor;
    const esperado = informado == null && params.pagamentos.length === 1
      ? centavosDaDuplicata(params.valorNota)
      : centavosDaDuplicata(informado);
    if (!Number.isFinite(esperado) || totalCentavos !== esperado) {
      const dinheiro = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      errors.push(Number.isFinite(esperado)
        ? `A soma das duplicatas (${dinheiro(totalCentavos)}) deve ser igual ao valor informado em Duplicata Mercantil (${dinheiro(esperado)}).`
        : "Informe um valor válido para Duplicata Mercantil.");
    }
  }
  return { cobranca: normalizadas.length ? { duplicatas: normalizadas, totalCentavos } : null, erros: errors };
}
