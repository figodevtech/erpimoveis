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
 * O produto avulso que uma comissão de criação cobre, quando é o caso.
 *
 * Produto avulso não tem `produtoid` — a referência dele é a linha da OS —,
 * então a comissão dele não pode ser agrupada pela coluna do id. A chave de
 * origem carrega o vínculo (`CRIACAO:<uuid>:A<id>`), e a receita correspondente
 * usa `AVULSO:<id>`: é por aí que os dois se encontram.
 */
function avulsoDaComissao(chaveOrigem?: string | null) {
  const encontrado = /^CRIACAO:[^:]+:A(\d+)$/.exec(String(chaveOrigem ?? ""));
  return encontrado ? encontrado[1] : null;
}

/**
 * Grupo de exibição do evento.
 *
 * Receita e despesa do mesmo item ficam juntas, e o que as une é o
 * `produtoid`/`servicoid` — nunca a `chave_origem`. É isso que faz uma despesa
 * manual de serviço, cuja chave é `MANUAL:<uuid>`, cair sob o serviço dela em
 * vez de virar um grupo solto.
 *
 * Comissão segue o item que a gerou: a de produto entra no bloco do produto, a
 * de serviço no do serviço. Enquanto só existia comissão de realização isso era
 * o mesmo que dizer "vai para o serviço", e a regra podia ser escrita assim; a
 * comissão de criação, que também cobra sobre produto, tornou a distinção
 * necessária — sem ela a comissão de um produto caía num grupo de serviço que
 * não existe.
 */
function grupoDoEvento(evento: EventoFinanceiroOs) {
  if (evento.origem === "PRODUTO") {
    return `0-produto-${evento.produtoid ?? evento.chave_origem ?? evento.id}`;
  }
  if (evento.origem === "COMISSAO") {
    if (evento.produtoid != null) return `0-produto-${evento.produtoid}`;
    const avulso = avulsoDaComissao(evento.chave_origem);
    if (avulso) return `0-produto-AVULSO:${avulso}`;
  }
  if (evento.origem === "SERVICO" || evento.origem === "COMISSAO") {
    return `1-servico-${evento.servicoid ?? evento.chave_origem?.split(":")[0] ?? evento.id}`;
  }
  // Ha uma unica receita de frete por OS e podem existir varios custos manuais
  // de transportadora. Todos formam o mesmo bloco, independentemente da chave
  // MANUAL de cada despesa.
  if (evento.origem === "FRETE") return "2-frete";
  return `3-avulso-${String(evento.id).padStart(12, "0")}`;
}

/**
 * Posição dentro do grupo: a receita abre, as despesas vêm sob ela, e a
 * comissão fecha.
 *
 * Vale igual para produto e para serviço — lê-se "cobrei isto, e me custou
 * aquilo" nos dois. Produto já foi ao contrário, com o custo antes da venda
 * ("comprei por, vendi por"); com a comissão de criação passando a incidir
 * sobre produto, as duas ordens diferentes deixavam o bloco de produto
 * ilegível: a comissão aparecia solta, longe da receita que a gerou.
 */
function ordemNoGrupo(evento: EventoFinanceiroOs) {
  if (evento.origem === "COMISSAO") return 2;
  if (evento.origem === "PRODUTO" || evento.origem === "SERVICO" || evento.origem === "FRETE") {
    return evento.natureza === "RECEITA" ? 0 : 1;
  }
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

export type OrdemComEventosSomaveis = {
  status: string;
  eventos: EventoSomavel[];
};

export type LucroRealDeStatus = {
  status: string;
  quantidadeOrdens: number;
  lucroReal: number;
};

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
 * Divide o mesmo lucro real do painel pelas situações atuais das OS.
 *
 * A unidade de agrupamento é a ordem, não o evento: todos os lançamentos da
 * OS acompanham o status dela. Isso permite separar o resultado que já está
 * em `CONCLUIDO` do que ainda está em `PAGAMENTO`, sem inventar uma segunda
 * fórmula de lucro. OS sem evento continuam na contagem e contribuem com zero.
 */
export function somarLucroRealPorStatus(ordens: OrdemComEventosSomaveis[]): LucroRealDeStatus[] {
  const porStatus = new Map<string, LucroRealDeStatus>();

  for (const ordem of ordens) {
    const atual = porStatus.get(ordem.status) ?? {
      status: ordem.status,
      quantidadeOrdens: 0,
      lucroReal: 0,
    };
    atual.quantidadeOrdens += 1;
    atual.lucroReal += somarEventosDaOs(ordem.eventos).lucroReal;
    porStatus.set(ordem.status, atual);
  }

  return [...porStatus.values()];
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

export type DeducaoDaOs = { origem: string; valor: number };

/**
 * As quatro origens que hoje aparecem em cards fixos no relatório, nesta
 * ordem. Uma origem fora desta lista não é descartada — ver `deducoesDaOs`.
 */
const ORDEM_DAS_DEDUCOES_CONHECIDAS = ["DESCONTO", "COMISSAO", "CONSUMO", "FRETE"] as const;

/**
 * O que falta, origem por origem, para os quatro subtotais de produto e
 * serviço chegarem ao lucro real: `quatro + Σ valor = lucroReal`.
 *
 * Cada valor é **líquido** — receita menos despesa daquela origem — e não um
 * total bruto com um sinal fixo por tipo. Essa era a conta antiga, e ela só
 * funcionava enquanto cada origem só gerava receita OU só despesa: comissão e
 * consumo são sempre despesa, desconto sempre despesa, e frete, até então, só
 * gerava receita. Quando o livro passou a lançar despesa de frete (frete
 * terceirizado), um sinal fixo positivo somava a despesa como se fosse
 * receita — dobrando o erro no lucro. Líquido por origem não tem esse
 * problema: funciona em qualquer combinação de natureza.
 */
export function deducoesDaOs(eventos: EventoSomavel[]): DeducaoDaOs[] {
  const porOrigem = new Map<string, number>();

  for (const evento of eventosAtivos(eventos)) {
    if (evento.origem === "PRODUTO" || evento.origem === "SERVICO") continue;
    const valor = Number(evento.valor ?? 0);
    const efeito = evento.natureza === "RECEITA" ? valor : -valor;
    porOrigem.set(evento.origem, (porOrigem.get(evento.origem) ?? 0) + efeito);
  }

  const conhecidas = ORDEM_DAS_DEDUCOES_CONHECIDAS.map((origem) => ({
    origem,
    valor: porOrigem.get(origem) ?? 0,
  }));

  const restantes = [...porOrigem.entries()]
    .filter(([origem]) => !(ORDEM_DAS_DEDUCOES_CONHECIDAS as readonly string[]).includes(origem))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([origem, valor]) => ({ origem, valor }));

  return [...conhecidas, ...restantes];
}

/** Comissão, com a parte que veio de produto. Ver `comissoesPorTipoDeItem`. */
export type EventoComissionavel = EventoSomavel & {
  /**
   * Quanto deste evento de comissão veio de **produto**.
   *
   * Desde `20260904150000` toda comissão sai por item, então na prática isto é
   * o valor inteiro (comissão de produto) ou zero (comissão de serviço). Segue
   * numérico, e não um booleano, porque o histórico anterior tem eventos de
   * criação que somavam produto e serviço num só — e eles precisam continuar
   * sendo repartidos na proporção certa.
   *
   * Produto avulso conta como produto: ele não tem `produtoid`, mas é venda de
   * mercadoria igual, e classificá-lo pela coluna do id o jogaria em serviços.
   */
  comissaoProdutos?: number | null;
};

export type ComissaoPorTipoDeItem = {
  /** Líquido, no mesmo sinal de `deducoesDaOs`: despesa vem negativa. */
  produtos: number;
  servicos: number;
};

/**
 * A comissão repartida entre o que ela cobrou de produto e o que cobrou de
 * serviço.
 *
 * Enquanto só existia comissão de realização, toda comissão era mão de obra de
 * serviço e o relatório podia somá-la inteira no líquido de serviços. A
 * comissão por criação quebrou isso: ela paga também sobre os produtos da OS, e
 * lançada como uma linha só inflava o líquido de produtos e afundava o de
 * serviços na mesma medida — dois números errados, com o lucro real certo,
 * que é o jeito mais difícil de perceber o problema.
 *
 * A parte de produto é aplicada como **proporção** do valor pago, não como
 * valor absoluto. Com a comissão por item isso é degenerado — a proporção é 1
 * ou 0 —, mas continua sendo o que mantém a conta fechando em dois casos: no
 * histórico anterior a `20260904150000`, em que um evento de criação somava
 * produto e serviço, e depois de uma correção manual, em que `valor` deixa de
 * ser o apurado. Somando as duas partes sempre se chega a `valor`, e é isso que
 * faz os cards do relatório fecharem com o lucro real.
 */
export function comissoesPorTipoDeItem(
  eventos: EventoComissionavel[],
): ComissaoPorTipoDeItem {
  let produtos = 0;
  let servicos = 0;

  for (const evento of eventosAtivos(eventos)) {
    if (evento.origem !== "COMISSAO") continue;

    const valor = Number(evento.valor ?? 0);
    const efeito = evento.natureza === "RECEITA" ? valor : -valor;
    const parteProduto = arredondar(efeito * fatiaDeProdutoDaComissao(evento));

    produtos += parteProduto;
    servicos += efeito - parteProduto;
  }

  return { produtos: arredondar(produtos), servicos: arredondar(servicos) };
}

/** A parte de produto de uma comissão, de 0 a 1. Sem valor pago não há proporção. */
function fatiaDeProdutoDaComissao(evento: EventoComissionavel) {
  const valor = Number(evento.valor ?? 0);
  const doProduto = Number(evento.comissaoProdutos ?? 0);
  return valor > 0 && Number.isFinite(doProduto) && doProduto > 0 ? Math.min(1, doProduto / valor) : 0;
}

function arredondar(valor: number) {
  return Math.round(valor * 100) / 100;
}

/**
 * Soma bruta (não líquida) dos eventos ativos de uma origem e natureza
 * específicas. Zero quando não há nenhum evento daquele par — nunca `NaN` nem
 * `undefined`, então o chamador não precisa de um `?? 0` próprio.
 *
 * É o que sustenta um card como "Receita de frete" separado de "Despesa de
 * frete": `deducoesDaOs` devolve o líquido de uma origem, que é o número certo
 * para fechar a conta, mas às vezes a exibição quer os dois lados brutos.
 */
export function somaOrigemNatureza(
  eventos: EventoSomavel[],
  origem: string,
  natureza: "RECEITA" | "DESPESA",
) {
  return eventosAtivos(eventos)
    .filter((evento) => evento.origem === origem && evento.natureza === natureza)
    .reduce((soma, evento) => soma + Number(evento.valor ?? 0), 0);
}

/** Margem do lucro sobre a receita, em porcento. Sem receita não há margem. */
export function margemDoLucro(totais: Pick<TotaisDosEventos, "receita" | "lucroReal">) {
  return totais.receita > 0 ? (totais.lucroReal / totais.receita) * 100 : 0;
}

/**
 * Os tipos de evento que a relação de OS deixa filtrar, na ordem dos cards.
 *
 * `OUTROS` é o balde do que não cabe nos dez — `AVULSO`, `ENTRADA_FISCAL` e a
 * origem que o banco vier a aceitar. Sem ele, marcar tudo esconderia esses
 * eventos, e a lista deixaria de fechar com o lucro real.
 */
export const CATEGORIAS_DE_EVENTO = [
  { chave: "RECEITA_PRODUTOS", label: "Receita de produtos" },
  { chave: "CUSTO_PRODUTOS", label: "Custo de produtos" },
  { chave: "RECEITA_SERVICOS", label: "Receita de serviços" },
  { chave: "CUSTO_SERVICOS", label: "Custo de serviços" },
  { chave: "COMISSOES_PRODUTOS", label: "Comissões de produtos" },
  { chave: "COMISSOES_SERVICOS", label: "Comissões de serviços" },
  { chave: "DESCONTOS", label: "Descontos" },
  { chave: "CONSUMO", label: "Consumo" },
  { chave: "RECEITA_FRETE", label: "Receita de frete" },
  { chave: "DESPESA_FRETE", label: "Despesa de frete" },
  { chave: "OUTROS", label: "Outros" },
] as const;

export type CategoriaDeEvento = (typeof CATEGORIAS_DE_EVENTO)[number]["chave"];

export type EventoClassificavel = EventoComissionavel & {
  /**
   * O item que a comissão cobre, quando se sabe. Decide só a comissão zerada:
   * zero de zero não é proporção, e `comissaoProdutos` nada diz ali.
   */
  itemDaComissao?: "PRODUTO" | "SERVICO" | null;
};

/**
 * Em que tipo do filtro o evento cai.
 *
 * A comissão se reparte pela mesma proporção de `comissoesPorTipoDeItem`, para
 * o filtro e os cards contarem a mesma história. O evento antigo de criação,
 * que somava produto e serviço, cai nos dois tipos — e aparece se qualquer um
 * estiver marcado.
 */
export function categoriasDoEvento(evento: EventoClassificavel): CategoriaDeEvento[] {
  const receita = evento.natureza === "RECEITA";

  switch (evento.origem) {
    case "PRODUTO":
      return [receita ? "RECEITA_PRODUTOS" : "CUSTO_PRODUTOS"];
    case "SERVICO":
      return [receita ? "RECEITA_SERVICOS" : "CUSTO_SERVICOS"];
    case "DESCONTO":
      return ["DESCONTOS"];
    case "CONSUMO":
      return ["CONSUMO"];
    case "FRETE":
      return [receita ? "RECEITA_FRETE" : "DESPESA_FRETE"];
    case "COMISSAO": {
      if (Number(evento.valor ?? 0) <= 0) {
        return [evento.itemDaComissao === "PRODUTO" ? "COMISSOES_PRODUTOS" : "COMISSOES_SERVICOS"];
      }
      const fatia = fatiaDeProdutoDaComissao(evento);
      const categorias: CategoriaDeEvento[] = [];
      if (fatia > 0) categorias.push("COMISSOES_PRODUTOS");
      if (fatia < 1) categorias.push("COMISSOES_SERVICOS");
      return categorias;
    }
    default:
      return ["OUTROS"];
  }
}

export function eventoPassaNoFiltro(
  evento: EventoClassificavel,
  selecionadas: ReadonlySet<CategoriaDeEvento>,
) {
  return categoriasDoEvento(evento).some((categoria) => selecionadas.has(categoria));
}
