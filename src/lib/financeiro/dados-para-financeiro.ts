import { getPaymentMethodValues } from "@/lib/payment-methods-server";
import type { PlannedPayment } from "@/lib/payment-methods";

export const GARANTIA_MAX_CARACTERES = 500;
export const PARCELAS_MAXIMAS = 12;

/** Mesma regra da OS: só crédito, boleto e promissória parcelam. */
export const formaAceitaParcelas = (metodo: string) =>
  metodo === "CREDITO" || metodo === "BOLETO" || metodo === "PROMISSORIA";

export type DadosParaFinanceiroBody = {
  pagamentosPrevistos?: unknown;
  descricaoFinanceiro?: unknown;
  garantia?: unknown;
};

export type ColunasDadosParaFinanceiro = {
  pagamentos_previstos: PlannedPayment[] | null;
  descricao_financeiro: string | null;
  garantia: string | null;
  parcelas_pagamento: number | null;
};

const paraCentavos = (valor: number) =>
  Math.round((Number.isFinite(valor) ? valor : 0) * 100);

/**
 * Valida os dados que a venda manda ao financeiro e devolve as colunas a gravar.
 *
 * Vive fora das rotas porque POST e PATCH de venda gravam a mesma coisa: uma
 * regra em duplicata acabaria valendo só no caminho que alguém lembrou de
 * atualizar. É a mesma validação que `PATCH /api/ordens/[id]/status` faz para a
 * OS — as formas vêm do cadastro, não de uma lista fixa no código.
 *
 * `totalEsperadoCents` confere se a soma fecha o total. Passando `null`, a soma
 * não é conferida: na edição, o total da venda pode estar mudando no mesmo
 * request, e cobrar o fechamento contra o valor antigo recusaria uma alteração
 * legítima.
 */
export async function normalizarDadosParaFinanceiro(
  body: DadosParaFinanceiroBody,
  totalEsperadoCents: number | null,
): Promise<{ erro: string } | { colunas: Partial<ColunasDadosParaFinanceiro> }> {
  const colunas: Partial<ColunasDadosParaFinanceiro> = {};

  if (body.descricaoFinanceiro !== undefined) {
    colunas.descricao_financeiro =
      String(body.descricaoFinanceiro ?? "").trim() || null;
  }

  if (body.garantia !== undefined) {
    const garantia = String(body.garantia ?? "").trim() || null;
    if (garantia && garantia.length > GARANTIA_MAX_CARACTERES) {
      return {
        erro: `A informação de garantia deve ter no máximo ${GARANTIA_MAX_CARACTERES} caracteres.`,
      };
    }
    colunas.garantia = garantia;
  }

  if (body.pagamentosPrevistos === undefined) {
    return { colunas };
  }

  if (body.pagamentosPrevistos === null) {
    colunas.pagamentos_previstos = null;
    colunas.parcelas_pagamento = null;
    return { colunas };
  }

  if (!Array.isArray(body.pagamentosPrevistos)) {
    return { erro: "As formas de pagamento previstas são inválidas." };
  }

  const formasValidas = new Set(await getPaymentMethodValues());
  const vistos = new Set<string>();
  const previstos: PlannedPayment[] = [];

  for (const item of body.pagamentosPrevistos) {
    const metodo = String((item as PlannedPayment)?.metodo ?? "").trim().toUpperCase();
    const valor = Number((item as PlannedPayment)?.valor);

    if (!formasValidas.has(metodo) || vistos.has(metodo)) {
      return {
        erro: "As formas de pagamento informadas são inválidas ou estão duplicadas.",
      };
    }
    vistos.add(metodo);

    if (!Number.isFinite(valor) || paraCentavos(valor) <= 0) {
      return { erro: "Informe um valor maior que zero para cada forma de pagamento." };
    }

    let parcelas: number | null = null;
    if (formaAceitaParcelas(metodo)) {
      parcelas = Number((item as PlannedPayment)?.parcelas ?? 1);
      if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > PARCELAS_MAXIMAS) {
        return {
          erro: `As parcelas de Crédito, Boleto ou Promissória devem estar entre 1 e ${PARCELAS_MAXIMAS}.`,
        };
      }
    }

    previstos.push({ metodo, valor, parcelas });
  }

  if (totalEsperadoCents !== null && previstos.length > 0) {
    const somaCents = previstos.reduce(
      (soma, pagamento) => soma + paraCentavos(pagamento.valor),
      0,
    );
    if (somaCents !== totalEsperadoCents) {
      return { erro: "A soma dos pagamentos precisa fechar o total da venda." };
    }
  }

  colunas.pagamentos_previstos = previstos.length > 0 ? previstos : null;
  // Espelha a OS: com uma forma só, a quantidade de parcelas vale para a venda
  // inteira e fica na coluna própria. Com várias, cada uma tem a sua e não há um
  // número único que descreva a venda.
  colunas.parcelas_pagamento =
    previstos.length === 1 ? (previstos[0].parcelas ?? null) : null;

  return { colunas };
}
