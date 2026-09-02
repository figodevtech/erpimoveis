// Modelo da relação de vendas: as vendas e seus itens são medidos como dados,
// antes de virar JSX, porque a folha corta o excedente sem avisar.
//
// Mesma divisão da relação de ordens (`../ordens/ordem-list-report-model.ts`),
// pelo mesmo motivo: com a paginação num arquivo puro ela pode ser testada sem
// montar a página, e a única forma de garantir que nada sai cortado é conferir a
// conta. O algoritmo é o mesmo de lá, deliberadamente duplicado — o modelo da OS
// já está em produção, e generalizar os dois arriscaria a folha que funciona
// para economizar linhas numa que ainda vai nascer.

export type SaleRow = {
  id: string;
  status: string;
  channel: string;
  category: string;
  customer: string;
  document: string;
  /** `venda.vendedor` — a quem a venda é atribuída, não quem a lançou. */
  seller: string;
  /**
   * `venda.created_by` — quem lançou. Fora do bloco impresso de propósito: a
   * terceira linha já está cheia, e no balcão criador e vendedor são a mesma
   * pessoa. Fica aqui para a faixa de filtros nomear o recorte.
   */
  creator: string;
  payment: string;
  installments: string;
  description: string;
  soldAt: string;
  paidAt: string;
  subtotal: number;
  discount: number;
  freight: number;
  total: number;
  surcharge: number;
};

export type ItemDaVenda = {
  /** Chave de render estável: a linha do item não traz id próprio na folha. */
  chave: string;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  precoUnitario: number;
  /** Em reais, já resolvido pela rota — nunca negativo. */
  descontoItem: number;
  /** Frete lançado no próprio item, à parte do frete da venda. */
  freteItem: number;
  /** Líquido do desconto do próprio item, sem o frete dele. */
  subtotal: number;
};

export type VendaComItens = { venda: SaleRow; itens: ItemDaVenda[] };

/* -------------------------------------------------------------------------
 * Orçamento de altura da folha, em milímetros.
 *
 * A4 retrato tem 297mm e 20mm vão nas margens, sobram 277mm. Todo valor abaixo
 * é múltiplo de 0,5 — exato em binário —, então a soma acumulada de uma folha
 * nunca acumula erro e a comparação com o limite dispensa epsilon.
 *
 * Os números são os mesmos da relação de ordens, e valem sem remedir: o bloco
 * da venda tem as mesmas três linhas do bloco da OS, na mesma fonte e na mesma
 * entrelinha, e a linha de item também. Mudar o número de linhas de qualquer um
 * dos dois blocos obriga a medir de novo.
 * ----------------------------------------------------------------------- */
export const MM_FOLHA_UTIL = 277;
export const MM_TOPO_PRIMEIRA = 58;
export const MM_TOPO_DEMAIS = 10;
export const MM_RODAPE_TOTAL = 8;

export const MM_VENDA = 13.5;
/** Cabeçalho condensado da venda que atravessa a virada de folha. */
export const MM_VENDA_CONTINUACAO = 3.5;
export const MM_ITEM = 3.5;
export const MM_FECHAMENTO = 3.5;
/**
 * A venda fecha com no máximo cinco parcelas (subtotal, desconto, frete,
 * acréscimo e o total), uma a menos que a OS, que ainda separa produtos de
 * serviços. A linha cabe folgada no caso comum; a segunda linha fica reservada
 * para o caso cheio, onde valores muito grandes passariam da largura da folha.
 */
export const MM_FECHAMENTO_DUPLO = 6.5;
export const MM_ESPACO_VENDA = 1.5;
/**
 * A faixa de rótulos dos itens sai uma vez por folha, não uma vez por venda:
 * repetir os rótulos acima de cada venda queimaria 4mm vezes o número delas.
 */
export const MM_CABECALHO_ITENS = 4.5;

export function capacidadeDaFolha(indice: number, detalhado: boolean) {
  const topo = indice === 0 ? MM_TOPO_PRIMEIRA : MM_TOPO_DEMAIS;
  return MM_FOLHA_UTIL - topo - MM_RODAPE_TOTAL - (detalhado ? MM_CABECALHO_ITENS : 0);
}

/**
 * Uma venda pode ocupar mais de uma folha; cada fatia sabe o que imprimir.
 *
 * Contrato do render, tudo derivável do que está aqui:
 * - `itens` cheio ......................... imprime essas linhas;
 * - vazio e `continuacao` falso ........... a venda não tem item: imprime o aviso;
 * - vazio e `continuacao` verdadeiro ...... só o fechamento, que não coubera.
 */
export type FatiaVenda = {
  venda: SaleRow;
  /** Vazio quando `detalhado` é falso — a folha imprime só o bloco da venda. */
  itens: ItemDaVenda[];
  continuacao: boolean;
  /** Só a fatia que fecha a venda imprime a linha de composição do valor. */
  fecha: boolean;
  /** Índice do primeiro item dentro da venda, para o zebrado não reiniciar. */
  primeiroIndice: number;
};

/** Sem itens e sem valor nenhum não há o que compor: o fechamento não sai. */
function temFechamento(venda: SaleRow, itens: ItemDaVenda[]) {
  return (
    itens.length > 0 ||
    venda.total !== 0 ||
    venda.freight !== 0 ||
    venda.surcharge !== 0
  );
}

/**
 * Quantas parcelas a linha de fechamento vai imprimir. As zeradas caem fora,
 * como nos cards do cabeçalho; o total entra sempre, por ser o resultado.
 */
export function contarParcelasDoFechamento(venda: SaleRow) {
  const parcelas = [venda.subtotal, venda.discount, venda.freight, venda.surcharge];
  return parcelas.filter((valor) => valor > 0).length + 1;
}

/**
 * Altura da linha de fechamento. Sai daqui e não do componente para o modelo e
 * o render nunca discordarem: quem mede e quem desenha leem a mesma conta.
 */
export function alturaDoFechamento(venda: SaleRow) {
  return contarParcelasDoFechamento(venda) >= 5 ? MM_FECHAMENTO_DUPLO : MM_FECHAMENTO;
}

export function paginarVendas(vendas: VendaComItens[], detalhado: boolean): FatiaVenda[][] {
  const folhas: FatiaVenda[][] = [];
  let folha: FatiaVenda[] = [];
  let usado = 0;

  const fechar = () => {
    if (folha.length) folhas.push(folha);
    folha = [];
    usado = 0;
  };
  const limite = () => capacidadeDaFolha(folhas.length, detalhado);

  for (const { venda, itens } of vendas) {
    // Caminho simples: uma fatia por venda, custando exatamente MM_VENDA — 15
    // vendas na primeira folha e 19 nas demais.
    if (!detalhado) {
      if (usado + MM_VENDA > limite() && folha.length) fechar();
      folha.push({ venda, itens: [], continuacao: false, fecha: false, primeiroIndice: 0 });
      usado += MM_VENDA;
      continue;
    }

    // A venda sem item ocupa uma linha assim mesmo: a do aviso. Sem ela o leitor
    // não distingue uma venda sem lançamento de uma opção que não funcionou.
    const totalLinhas = Math.max(1, itens.length);
    const custoFechamento = temFechamento(venda, itens) ? alturaDoFechamento(venda) : 0;
    let cursor = 0;
    let continuacao = false;
    let fechamentoImpresso = custoFechamento === 0;

    while (cursor < totalLinhas) {
      const abertura = continuacao ? MM_VENDA_CONTINUACAO : MM_VENDA;
      let disponivel = limite() - usado - abertura - MM_ESPACO_VENDA;

      // Viúva: não vale abrir uma venda no pé da folha para caber uma linha só.
      // O `min` poupa a venda de item único de ser empurrada à toa.
      const minimo = Math.min(totalLinhas - cursor, 2) * MM_ITEM;
      if (disponivel < minimo && folha.length) {
        fechar();
        disponivel = limite() - abertura - MM_ESPACO_VENDA;
      }

      let cabem = 0;
      let altura = 0;
      let levaFechamento = false;
      for (let linha = cursor; linha < totalLinhas; linha += 1) {
        const ultima = linha === totalLinhas - 1;
        const extra = ultima ? custoFechamento : 0;
        if (altura + MM_ITEM + extra > disponivel && cabem > 0) break;
        altura += MM_ITEM + extra;
        cabem += 1;
        // Levar a última linha só imprime o fechamento se houver fechamento: a
        // venda sem valor nenhum termina na própria lista.
        levaFechamento = ultima && custoFechamento > 0;
      }

      // Guarda anti-laço: numa folha vazia entra pelo menos uma linha, mesmo
      // estourando o limite. Sem ela, uma linha mais alta que a folha inteira
      // gira para sempre.
      if (cabem === 0) {
        if (folha.length) {
          fechar();
          continue;
        }
        cabem = 1;
        altura = MM_ITEM;
        levaFechamento = false;
      }

      folha.push({
        venda,
        itens: itens.slice(cursor, cursor + cabem),
        continuacao,
        fecha: levaFechamento,
        primeiroIndice: cursor,
      });
      usado += abertura + altura + MM_ESPACO_VENDA;
      cursor += cabem;
      continuacao = true;
      if (levaFechamento) fechamentoImpresso = true;
      // Fecha a folha só quando a venda de fato continua na seguinte — nunca
      // porque ela acabou sem linha de fechamento.
      if (cursor < totalLinhas) fechar();
    }

    // Os itens fecharam a folha exatamente e o fechamento não coube: ele sai
    // sozinho na folha seguinte, sob o cabeçalho de continuação.
    if (!fechamentoImpresso) {
      const custo = MM_VENDA_CONTINUACAO + alturaDoFechamento(venda) + MM_ESPACO_VENDA;
      if (usado + custo > limite() && folha.length) fechar();
      folha.push({ venda, itens: [], continuacao: true, fecha: true, primeiroIndice: totalLinhas });
      usado += custo;
    }
  }

  fechar();
  return folhas.length ? folhas : [[]];
}
