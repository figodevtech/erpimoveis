import { Transaction } from "../fluxodecaixa/types";

export type PaymentSettler = {
  /** Nome exibido na coluna: quem executou a ultima baixa. */
  nome: string;
  /** Quantos outros usuarios tambem lancaram pagamentos nesta OS/venda. */
  outros: number;
  /** Todos os autores, do mais recente para o mais antigo, para o tooltip. */
  todos: string[];
};

const NOME_DESCONHECIDO = "Não identificado";

/**
 * Resume quem deu baixa nos pagamentos de uma OS ou venda.
 *
 * As transacoes chegam com `baixadoPor` resolvido pela API (o `baixado_por` da
 * tabela `transacao` e um uuid solto, sem FK para `usuario`). Pagamentos antigos,
 * anteriores a esse registro, ficam sem autor — nesses casos devolvemos `null`
 * para a lista mostrar apenas um traco.
 */
export function resumirBaixas(transacoes: Transaction[] | null | undefined): PaymentSettler | null {
  const pagamentos = (transacoes ?? [])
    .filter(
      (t) =>
        String(t?.tipo ?? "").toUpperCase() === "RECEITA" &&
        t?.evento_financeiro_id == null &&
        t?.is_deleted !== true &&
        t?.pendente !== true,
    )
    .sort((a, b) => new Date(b?.data ?? 0).getTime() - new Date(a?.data ?? 0).getTime());

  if (!pagamentos.length) return null;

  const nomes: string[] = [];
  for (const pagamento of pagamentos) {
    const nome = pagamento.baixadoPor?.nome?.trim() || (pagamento.baixado_por ? NOME_DESCONHECIDO : null);
    if (nome && !nomes.includes(nome)) nomes.push(nome);
  }

  if (!nomes.length) return null;

  return { nome: nomes[0], outros: nomes.length - 1, todos: nomes };
}
