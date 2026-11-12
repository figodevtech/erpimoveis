/**
 * Extrato do proprietário como ele deve ler: uma linha por pagamento ou lançamento.
 *
 * O `imovel_movimento` é um razão que só recebe linhas novas: ajustar a taxa de um pagamento
 * grava a diferença como outra linha, e editar uma despesa ou um repasse grava o estorno da
 * versão antiga e a versão nova. A soma fica certa, mas o proprietário veria duas taxas para o
 * mesmo pagamento. Aqui as linhas do mesmo pagamento (ou lançamento) e do mesmo tipo viram uma,
 * com o valor somado. O ERP continua mostrando o razão completo, para auditoria.
 */

type Movimento = Record<string, any>;

const centavos = (valor: unknown) => Math.round(Number(valor ?? 0) * 100);

function chave(movimento: Movimento) {
  // O que falta pagar de um repasse fica numa linha própria, ao lado do que já foi pago.
  if (movimento.repasse_pendente === true) return `p:${movimento.lancamento_id ?? movimento.id}`;
  if (movimento.transacao_chave != null) return `t:${movimento.transacao_chave}:${movimento.tipo}`;
  if (movimento.lancamento_id != null) return `l:${movimento.lancamento_id}:${movimento.tipo}`;
  return `m:${movimento.id}`;
}

const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "20% sobre R$ 598,00 recebidos · Reserva #64 - ..." (no reembolso, "reembolsados"). */
function descricaoDaTaxa(taxa: number, bruto: number, descricao: unknown) {
  const percentual = (Math.round((Math.abs(taxa) / Math.abs(bruto)) * 10000) / 100)
    .toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const base = `${percentual}% sobre ${reais.format(Math.abs(bruto))} ${bruto < 0 ? "reembolsados" : "recebidos"}`;
  const origem = String(descricao ?? "").replace(/^(Estorno|Ajuste): /, "").trim();
  return origem ? `${base} · ${origem}` : base;
}

export function consolidarMovimentos<T extends Movimento>(movimentos: T[]): T[] {
  const grupos = new Map<string, T[]>();
  for (const movimento of movimentos) {
    const lista = grupos.get(chave(movimento));
    if (lista) lista.push(movimento);
    else grupos.set(chave(movimento), [movimento]);
  }

  const consolidados: T[] = [];
  for (const lista of grupos.values()) {
    const total = lista.reduce((soma, movimento) => soma + centavos(movimento.valor), 0);
    // Estornado por inteiro (pagamento excluído, taxa zerada): não há o que mostrar.
    if (total === 0) continue;
    const ordem = [...lista].sort((a, b) => Number(a.id) - Number(b.id));
    // Data e descrição vêm da versão vigente: a linha positiva mais recente. Estornos
    // ("Estorno: ...", "Ajuste: ...") não servem de referência; sem positiva, vale a primeira.
    const vigente = ordem.filter((movimento) => centavos(movimento.valor) > 0).at(-1) ?? ordem[0];
    consolidados.push({ ...vigente, valor: total / 100 });
  }

  // A taxa herda do banco a descrição do pagamento; sem o percentual, as duas linhas ficam iguais.
  const brutoPorPagamento = new Map(
    consolidados.filter((item) => item.tipo === "BRUTO_RECEBIDO" && item.transacao_chave != null)
      .map((item) => [String(item.transacao_chave), Number(item.valor)])
  );
  for (const item of consolidados) {
    const bruto = item.tipo === "TAXA_ADMIN" && item.transacao_chave != null ? brutoPorPagamento.get(String(item.transacao_chave)) : undefined;
    if (bruto) Object.assign(item, { descricao: descricaoDaTaxa(Number(item.valor), bruto, item.descricao) });
    // Registrado na conta do proprietário, mas ainda não lançado (ou não pago) no financeiro.
    if (item.tipo === "REPASSE" && item.repasse_pendente === true && Number(item.valor) > 0) {
      Object.assign(item, { descricao: `${String(item.descricao ?? "Repasse").trim()} (pendente)` });
    }
  }

  return consolidados.sort(
    (a, b) => Date.parse(b.data_movimento) - Date.parse(a.data_movimento) || Number(b.id) - Number(a.id)
  );
}
