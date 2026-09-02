// Regras de leitura dos eventos financeiros de uma OS: quais contam, em que
// ordem aparecem e como viram receita, despesa e lucro real.
//
// A mesma regra vale no painel do dialog de detalhes da OS, na rota
// `/api/ordens/[id]/eventos-financeiros` e na relação de ordens impressa. Ela
// mora aqui para as três não divergirem — três cópias de uma regra de dinheiro
// divergem em silêncio, e quem descobre é o dono da oficina conferindo o lucro.

export type EventoFinanceiroOs = {
  id: number;
  /**
   * Texto livre de propósito, e não uma união.
   *
   * O banco já aceita `ENTRADA_FISCAL` (check constraint em
   * `20260828100000_dre_tributos_de_entrada.sql`) e a união declarada no dialog
   * não a inclui. Uma origem nova não pode quebrar a leitura: ela cai no balde
   * dos avulsos e entra nos totais gerais, que é o comportamento seguro.
   */
  origem: string;
  natureza: "RECEITA" | "DESPESA";
  status: string;
  valor: number;
  produtoid?: number | null;
  servicoid?: number | null;
  chave_origem?: string | null;
};

/**
 * Evento cancelado não conta em lugar nenhum — nem na lista, nem nos totais.
 * `CONVERTIDO` conta: já virou lançamento, mas o dinheiro é o mesmo.
 */
export function eventosAtivos<T extends { status: string }>(eventos: T[]) {
  return eventos.filter((evento) => evento.status !== "CANCELADO");
}

/**
 * Grupo de exibição do evento.
 *
 * Receita e despesa do mesmo item ficam juntas, e o que as une é o
 * `produtoid`/`servicoid` — nunca a `chave_origem`. É isso que faz uma despesa
 * manual de serviço, cuja chave é `MANUAL:<uuid>`, cair sob o serviço dela em
 * vez de virar um grupo solto. A comissão entra no grupo do serviço porque
 * carrega o mesmo `servicoid`.
 */
function grupoDoEvento(evento: EventoFinanceiroOs) {
  if (evento.origem === "PRODUTO") {
    return `0-produto-${evento.produtoid ?? evento.chave_origem ?? evento.id}`;
  }
  if (evento.origem === "SERVICO" || evento.origem === "COMISSAO") {
    return `1-servico-${evento.servicoid ?? evento.chave_origem?.split(":")[0] ?? evento.id}`;
  }
  return `2-avulso-${String(evento.id).padStart(12, "0")}`;
}

/**
 * Posição dentro do grupo.
 *
 * Em produto o custo vem antes da venda; em serviço a receita vem antes do
 * custo. Não é capricho: no produto se lê "comprei por, vendi por", e no
 * serviço "cobrei, e me custou".  A comissão fecha o grupo do serviço.
 */
function ordemNoGrupo(evento: EventoFinanceiroOs) {
  if (evento.origem === "PRODUTO") return evento.natureza === "DESPESA" ? 0 : 1;
  if (evento.origem === "SERVICO") return evento.natureza === "RECEITA" ? 0 : 1;
  if (evento.origem === "COMISSAO") return 2;
  return 0;
}

/** Ordena sem alterar o array recebido. A data do evento não entra na conta. */
export function ordenarEventosDaOs<T extends EventoFinanceiroOs>(eventos: T[]) {
  return [...eventos].sort(
    (a, b) =>
      grupoDoEvento(a).localeCompare(grupoDoEvento(b), "pt-BR", { numeric: true }) ||
      ordemNoGrupo(a) - ordemNoGrupo(b) ||
      a.id - b.id,
  );
}

export type TotaisDosEventos = {
  receita: number;
  despesa: number;
  lucroReal: number;
  receitaProdutos: number;
  receitaServicos: number;
  despesaProdutos: number;
  despesaServicos: number;
};

/** Só o que a conta usa: quem tem os quatro campos pode somar. */
export type EventoSomavel = Pick<EventoFinanceiroOs, "origem" | "natureza" | "status" | "valor">;

/**
 * Os totais do painel.
 *
 * Atenção à assimetria, que é intencional: `receita` e `despesa` somam **todas**
 * as origens, enquanto os quatro subtotais contam só `PRODUTO` e `SERVICO`
 * estritos. Comissão, frete, desconto, avulso e entrada fiscal entram no lucro
 * e em nenhum dos quatro — numa OS com comissão os quatro não somam o lucro, e
 * é assim que o painel da tela sempre mostrou.
 */
export function somarEventosDaOs(eventos: EventoSomavel[]): TotaisDosEventos {
  const totais: TotaisDosEventos = {
    receita: 0,
    despesa: 0,
    lucroReal: 0,
    receitaProdutos: 0,
    receitaServicos: 0,
    despesaProdutos: 0,
    despesaServicos: 0,
  };

  for (const evento of eventosAtivos(eventos)) {
    const valor = Number(evento.valor ?? 0);
    const receita = evento.natureza === "RECEITA";

    if (receita) totais.receita += valor;
    else totais.despesa += valor;

    if (evento.origem === "PRODUTO") {
      if (receita) totais.receitaProdutos += valor;
      else totais.despesaProdutos += valor;
    } else if (evento.origem === "SERVICO") {
      if (receita) totais.receitaServicos += valor;
      else totais.despesaServicos += valor;
    }
  }

  totais.lucroReal = totais.receita - totais.despesa;
  return totais;
}

/**
 * O que entra no lucro mas não cabe em nenhum dos quatro subtotais: comissão,
 * desconto, frete, avulso, entrada fiscal — e o que o banco vier a aceitar
 * depois. Uma entrada por par de origem e natureza, da maior para a menor.
 *
 * É a decomposição exata da diferença entre a soma dos quatro e o lucro real.
 * Somando estas entradas com o sinal da natureza, a conta fecha.
 */
export function outrasOrigensDaOs(eventos: EventoSomavel[]) {
  const porChave = new Map<string, { origem: string; natureza: "RECEITA" | "DESPESA"; total: number }>();

  for (const evento of eventosAtivos(eventos)) {
    if (evento.origem === "PRODUTO" || evento.origem === "SERVICO") continue;
    const chave = `${evento.origem}|${evento.natureza}`;
    const atual = porChave.get(chave) ?? { origem: evento.origem, natureza: evento.natureza, total: 0 };
    atual.total += Number(evento.valor ?? 0);
    porChave.set(chave, atual);
  }

  return [...porChave.values()].sort((a, b) => b.total - a.total);
}

/** Margem do lucro sobre a receita, em porcento. Sem receita não há margem. */
export function margemDoLucro(totais: Pick<TotaisDosEventos, "receita" | "lucroReal">) {
  return totais.receita > 0 ? (totais.lucroReal / totais.receita) * 100 : 0;
}
