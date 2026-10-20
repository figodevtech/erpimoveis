import type { SpedDiagnostic } from "@/lib/sped/efd-icms-ipi";

/**
 * Registro 1601 a partir do financeiro.
 *
 * Regras da SEFAZ-PB (Esclarecimentos sobre a escrituração do Registro 1601):
 * - regime de competência: entra a venda do mês, pelo valor total, ainda que
 *   parcelada ou recebida depois; o momento do repasse não importa;
 * - entra o que passa por instituição: cartão, PIX, TED/DOC, transferência,
 *   boleto e cheque; dinheiro recebido no caixa não entra;
 * - sem juros, multa, estornos e cancelamentos;
 * - uma linha por instituição (CNPJ), com o valor dividido entre ICMS (TOT_VS),
 *   ISS (TOT_ISS) e o restante (TOT_OUTROS).
 *
 * A instituição é o banco da conta em que o recebimento foi lançado, inclusive
 * no cartão: a maquininha é a do banco da conta.
 */

/** Meios que transitam por instituição financeira ou de pagamento. */
export const ELECTRONIC_PAYMENT_METHODS = new Set([
  "PIX", "CREDITO", "DEBITO", "BOLETO", "TRANSFERENCIA", "TED", "DOC", "CHEQUE", "CREDITO EM CONTA", "DEBITO AUTOMATICO",
]);

/** Fração do recebimento em cada campo do 1601. Tudo zero: fora do 1601. */
export type Sped1601Split = { vs: number; iss: number; outros: number };

export const SPLIT_EXCLUDED: Sped1601Split = { vs: 0, iss: 0, outros: 0 };

/**
 * Receita que não é de OS nem de venda: o plano de contas diz o que ela é.
 * Financeira, empréstimo, transferência entre contas, aporte e adiantamento não
 * são operação paga por cliente e ficam fora.
 */
const SPLIT_BY_CLASSIFICATION: Record<string, Sped1601Split> = {
  RECEITA_PRODUTOS: { vs: 1, iss: 0, outros: 0 },
  RECEITA_FRETE: { vs: 1, iss: 0, outros: 0 },
  RECEITA_SERVICOS: { vs: 0, iss: 1, outros: 0 },
  RECEITA_OPERACIONAL_OUTRA: { vs: 0, iss: 0, outros: 1 },
  OUTRO_GANHO: { vs: 0, iss: 0, outros: 1 },
  // Recebimento pela venda de um bem da empresa.
  PATRIMONIAL_IMOBILIZADO: { vs: 0, iss: 0, outros: 1 },
};

export function splitForClassification(code: string | null | undefined): Sped1601Split {
  return SPLIT_BY_CLASSIFICATION[String(code ?? "")] ?? SPLIT_EXCLUDED;
}

/** OS: peças e frete são ICMS, serviços são ISS, na proporção da própria OS. */
export function splitForServiceOrder(parts: number, services: number): Sped1601Split {
  const total = Math.max(0, parts) + Math.max(0, services);
  // OS sem itens valorizados: o que a oficina vende é o serviço.
  if (total <= 0) return { vs: 0, iss: 1, outros: 0 };
  return { vs: Math.max(0, parts) / total, iss: Math.max(0, services) / total, outros: 0 };
}

export type Sped1601Receipt = {
  transactionId: number;
  method: string;
  accountId: number | null;
  /** Valor recebido (ou a receber) sem juros e multa. */
  amount: number;
  split: Sped1601Split;
};

export type Sped1601Account = { id: number; title: string; cnpj: string | null };

/** Mesmo formato das linhas importadas por CSV (fiscal_sped_1601_linha). */
export type Sped1601Row = {
  id: string;
  instituicao_codigo_participante: string;
  instituicao_nome: string;
  instituicao_cnpj: string;
  intermediario_codigo_participante: string;
  intermediario_nome: string;
  intermediario_cnpj: string;
  total_operacoes: number;
  total_iss: number;
  total_outros: number;
};

const cents = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function build1601FromReceipts(input: {
  receipts: readonly Sped1601Receipt[];
  accounts: ReadonlyMap<number, Sped1601Account>;
  institutionName?: (cnpj: string) => string | null;
}): { rows: Sped1601Row[]; diagnostics: SpedDiagnostic[] } {
  const byInstitution = new Map<string, { names: Set<string>; vs: number; iss: number; outros: number }>();
  const withoutAccount = new Map<string, { count: number; total: number }>();
  const withoutCnpj = new Map<number, { count: number; total: number }>();

  for (const receipt of input.receipts) {
    const method = String(receipt.method ?? "").trim().toUpperCase();
    const { vs, iss, outros } = receipt.split;
    if (!ELECTRONIC_PAYMENT_METHODS.has(method) || !(receipt.amount > 0) || vs + iss + outros <= 0) continue;
    const account = receipt.accountId == null ? null : input.accounts.get(receipt.accountId) ?? null;
    if (!account) {
      const entry = withoutAccount.get(method) ?? { count: 0, total: 0 };
      withoutAccount.set(method, { count: entry.count + 1, total: entry.total + receipt.amount });
      continue;
    }
    if (!account.cnpj) {
      const entry = withoutCnpj.get(account.id) ?? { count: 0, total: 0 };
      withoutCnpj.set(account.id, { count: entry.count + 1, total: entry.total + receipt.amount });
      continue;
    }
    const entry = byInstitution.get(account.cnpj) ?? { names: new Set<string>(), vs: 0, iss: 0, outros: 0 };
    entry.names.add(account.title);
    entry.vs += receipt.amount * vs;
    entry.iss += receipt.amount * iss;
    entry.outros += receipt.amount * outros;
    byInstitution.set(account.cnpj, entry);
  }

  const rows = Array.from(byInstitution.entries())
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([cnpj, entry]) => ({
      id: `financeiro:${cnpj}`,
      // Mesmo código do participante das notas (P + documento): um 0150 só.
      instituicao_codigo_participante: `P${cnpj}`,
      instituicao_nome: input.institutionName?.(cnpj) || Array.from(entry.names).sort().join(" / "),
      instituicao_cnpj: cnpj,
      intermediario_codigo_participante: "",
      intermediario_nome: "",
      intermediario_cnpj: "",
      total_operacoes: cents(entry.vs),
      total_iss: cents(entry.iss),
      total_outros: cents(entry.outros),
    }))
    .filter((row) => row.total_operacoes + row.total_iss + row.total_outros > 0);

  const diagnostics: SpedDiagnostic[] = [];
  for (const [accountId, entry] of withoutCnpj) {
    const account = input.accounts.get(accountId)!;
    diagnostics.push({
      code: "CONTA_SEM_CNPJ_INSTITUICAO",
      severity: "BLOQUEIO",
      message: `A conta "${account.title}" recebeu ${money(entry.total)} em ${entry.count} lançamento(s) por meio eletrônico no mês e não tem o CNPJ da instituição. Informe o CNPJ no cadastro da conta para esses valores entrarem no 1601.`,
      record: "1601",
      source: { source: "BANCO", table: "bancoconta", id: accountId },
      context: { accountId, total: cents(entry.total), count: entry.count },
    });
  }
  for (const [method, entry] of withoutAccount) {
    diagnostics.push({
      code: "RECEBIMENTO_ELETRONICO_SEM_CONTA",
      severity: "BLOQUEIO",
      message: `${entry.count} recebimento(s) de vendas do mês por ${method} somam ${money(entry.total)} sem conta bancária. Sem a conta não há como saber a instituição do 1601: informe a conta no lançamento.`,
      record: "1601",
      source: { source: "BANCO", table: "transacao" },
      context: { method, total: cents(entry.total), count: entry.count },
    });
  }
  return { rows, diagnostics };
}
