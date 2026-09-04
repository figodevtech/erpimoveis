// Modelo da relação de ordens de serviço: as ordens e seus itens são medidos
// como dados, antes de virar JSX, porque a folha corta o excedente sem avisar.
//
// Mesma divisão do relatório diário (`../diario/report-model.ts`), pelo mesmo
// motivo: com a paginação num arquivo puro ela pode ser testada sem montar a
// página, e a única forma de garantir que nada sai cortado é conferir a conta.

export type OrderRow = {
  id: string;
  status: string;
  priority: string;
  customer: string;
  document: string;
  target: string;
  sector: string;
  owner: string;
  description: string;
  openedAt: string;
  closedAt: string;
  products: number;
  services: number;
  discount: number;
  freight: number;
  budget: number;
  surcharge: number;
};

/**
 * A linha que abre sob uma ordem. O modelo não precisa saber se é um item do
 * orçamento ou um evento financeiro: as duas ocupam a mesma altura, e o que
 * muda é só o que a folha desenha dentro delas.
 */
export type LinhaDaOrdem = { chave: string };

export type OrdemComLinhas<L extends LinhaDaOrdem = LinhaDaOrdem> = {
  ordem: OrderRow;
  linhas: L[];
};

/**
 * O que a folha abre sob cada ordem.
 *
 * `eventos` muda o fechamento: em vez das parcelas do orçamento, saem receita e
 * custo de produto e de serviço mais o lucro real.
 */
export type ModoDaFolha = "simples" | "itens" | "eventos";

/* -------------------------------------------------------------------------
 * Orçamento de altura da folha, em milímetros.
 *
 * A4 retrato tem 297mm e 20mm vão nas margens, sobram 277mm. Todo valor abaixo
 * é múltiplo de 0,5 — exato em binário —, então a soma acumulada de uma folha
 * nunca acumula erro e a comparação com o limite dispensa epsilon.
 *
 * Os números não são estimados: saíram de medir a folha renderizada, bloco por
 * bloco, e cada um arredonda para cima do que o layout ocupa de fato. Antes
 * eram chutes, e o bloco da ordem vinha 3,8mm curto — a terceira linha, com as
 * datas e a descrição, era cortada em toda OS sem ninguém ver.
 *
 * Medido com a fonte atual e entrelinha 1,2: cabeçalho da primeira folha
 * 56,45mm, bloco da ordem 13,28mm, faixa de rótulos 4,07mm, linha de item
 * 2,86mm, continuação 3,12mm, fechamento 2,80mm.
 *
 * De toda folha ainda se desconta a folga do rodapé de total, que cai só na
 * última — e qual será a última só se sabe depois de paginar. Desperdiça 8mm
 * nas demais, e é de propósito: a alternativa é paginar duas vezes.
 * ----------------------------------------------------------------------- */
export const MM_FOLHA_UTIL = 277;
export const MM_TOPO_PRIMEIRA = 58;
export const MM_TOPO_DEMAIS = 10;
export const MM_RODAPE_TOTAL = 8;

export const MM_ORDEM = 13.5;
/** Cabeçalho condensado da OS que atravessa a virada de folha. */
export const MM_ORDEM_CONTINUACAO = 3.5;
export const MM_ITEM = 3.5;
export const MM_FECHAMENTO = 3.5;
/**
 * O fechamento cheio — as quatro parcelas, o orçamento e o acréscimo — mede
 * 174mm de largura contra os 176mm da folha. Cabe numa linha, mas por 2mm, e
 * uma oficina com valores na casa do milhão passaria disso: a linha quebraria
 * em duas e a segunda sairia cortada. Da quinta parcela em diante reserva-se a
 * segunda linha, e o caso comum (produtos, serviços e orçamento) não paga nada.
 */
export const MM_FECHAMENTO_DUPLO = 6.5;
export const MM_ESPACO_ORDEM = 1.5;
/**
 * A faixa de rótulos dos itens sai uma vez por folha, não uma vez por OS:
 * repetir nove rótulos acima de cada ordem queimaria 4mm vezes o número delas.
 */
export const MM_CABECALHO_ITENS = 4.5;
/**
 * Uma fileira de cards do painel, com o vão que a antecede.
 *
 * `MM_TOPO_PRIMEIRA` já conta duas fileiras, que é o caso normal. Cada fileira
 * além disso soma este valor: o painel cresce quando o recorte tem comissão,
 * desconto, frete e o que mais existir, e a grade não pode passar de cinco
 * colunas — medido, o rótulo mais longo tem 28mm e a sexta coluna o cortaria.
 */
export const MM_FILEIRA_PAINEL = 12.5;
export const COLUNAS_MAXIMAS_DO_PAINEL = 5;

/** Quatro cards preservam os rótulos longos dos status numa folha A4. */
export const COLUNAS_LUCRO_STATUS = 4;
/** Margem superior + título + primeira linha de cards. */
export const MM_LUCRO_STATUS_BASE = 16;
/** Altura do card (10mm) mais o vão (2mm) de cada linha adicional. */
export const MM_LUCRO_STATUS_FILEIRA_ADICIONAL = 12;

export function alturaLucroRealPorStatus(quantidadeStatus: number) {
  if (quantidadeStatus <= 0) return 0;
  const fileiras = Math.ceil(quantidadeStatus / COLUNAS_LUCRO_STATUS);
  return MM_LUCRO_STATUS_BASE + Math.max(0, fileiras - 1) * MM_LUCRO_STATUS_FILEIRA_ADICIONAL;
}

export function capacidadeDaFolha(
  indice: number,
  modo: ModoDaFolha,
  fileirasDoPainel = 2,
  alturaAdicionalPrimeira = 0,
) {
  const painel = indice === 0 ? Math.max(0, fileirasDoPainel - 2) * MM_FILEIRA_PAINEL : 0;
  const adicional = indice === 0 ? Math.max(0, alturaAdicionalPrimeira) : 0;
  const topo = (indice === 0 ? MM_TOPO_PRIMEIRA : MM_TOPO_DEMAIS) + painel + adicional;
  return MM_FOLHA_UTIL - topo - MM_RODAPE_TOTAL - (modo === "simples" ? 0 : MM_CABECALHO_ITENS);
}

/**
 * Uma OS pode ocupar mais de uma folha; cada fatia sabe o que imprimir.
 *
 * Contrato do render, tudo derivável do que está aqui:
 * - `linhas` cheio ........................ imprime essas linhas;
 * - vazio e `continuacao` falso ........... nada lançado: imprime o aviso;
 * - vazio e `continuacao` verdadeiro ...... só o fechamento, que não coubera.
 */
export type FatiaOrdem<L extends LinhaDaOrdem = LinhaDaOrdem> = {
  ordem: OrderRow;
  /** Vazio no modo simples — a folha imprime só o bloco da ordem. */
  linhas: L[];
  continuacao: boolean;
  /** Só a fatia que fecha a OS imprime a linha de composição do valor. */
  fecha: boolean;
  /** Índice do primeiro item dentro da OS, para o zebrado não reiniciar. */
  primeiroIndice: number;
};

/**
 * Sem nada lançado e sem valor nenhum não há o que compor.
 *
 * No modo de eventos o fechamento sai sempre que houver evento: uma OS pode ter
 * custo sem ter orçamento, e é justamente aí que o lucro real interessa.
 */
function temFechamento(ordem: OrderRow, linhas: LinhaDaOrdem[], modo: ModoDaFolha) {
  if (modo === "eventos") return linhas.length > 0;
  return linhas.length > 0 || ordem.budget !== 0 || ordem.freight !== 0 || ordem.surcharge !== 0;
}

/**
 * Quantas parcelas a linha de fechamento vai imprimir. As zeradas caem fora,
 * como nos cards do cabeçalho; o orçamento entra sempre, por ser o resultado.
 */
export function contarParcelasDoFechamento(ordem: OrderRow) {
  const parcelas = [ordem.products, ordem.services, ordem.discount, ordem.freight, ordem.surcharge];
  return parcelas.filter((valor) => valor > 0).length + 1;
}

/**
 * Altura da linha de fechamento. Sai daqui e não do componente para o modelo e
 * o render nunca discordarem: quem mede e quem desenha leem a mesma conta.
 *
 * No modo de eventos são sempre oito entradas — receita e custo de produto e de
 * serviço, descontos, comissões, frete e o lucro real —, e com elas a conta
 * fecha: somando as sete com o sinal de cada uma chega-se ao lucro.
 *
 * Oito não cabem numa linha: medidas, somam 226mm numa OS comum e 248mm com
 * valores altos, contra 176mm de folha. Quebram em duas, e duas linhas medem
 * 5,66mm. Por isso o modo de eventos reserva sempre o fechamento duplo — não
 * depende do tamanho dos números, então não há caso extremo a adivinhar.
 */
export function alturaDoFechamento(ordem: OrderRow, modo: ModoDaFolha) {
  if (modo === "eventos") return MM_FECHAMENTO_DUPLO;
  return contarParcelasDoFechamento(ordem) >= 5 ? MM_FECHAMENTO_DUPLO : MM_FECHAMENTO;
}

export function paginarOrdens<L extends LinhaDaOrdem>(
  ordens: OrdemComLinhas<L>[],
  modo: ModoDaFolha,
  /** Quantas fileiras de cards a primeira folha vai imprimir. */
  fileirasDoPainel = 2,
  /** Seções variáveis abaixo do painel, medidas em milímetros. */
  alturaAdicionalPrimeira = 0,
): FatiaOrdem<L>[][] {
  const folhas: FatiaOrdem<L>[][] = [];
  let folha: FatiaOrdem<L>[] = [];
  let usado = 0;

  const fechar = () => {
    if (folha.length) folhas.push(folha);
    folha = [];
    usado = 0;
  };
  const limite = () => capacidadeDaFolha(folhas.length, modo, fileirasDoPainel, alturaAdicionalPrimeira);

  for (const { ordem, linhas: itens } of ordens) {
    // Caminho simples: uma fatia por OS, custando exatamente MM_ORDEM — 15
    // ordens na primeira folha e 19 nas demais.
    if (modo === "simples") {
      if (usado + MM_ORDEM > limite() && folha.length) fechar();
      folha.push({ ordem, linhas: [], continuacao: false, fecha: false, primeiroIndice: 0 });
      usado += MM_ORDEM;
      continue;
    }

    // A OS sem lançamento ocupa uma linha assim mesmo: a do aviso. Sem ela o
    // leitor não distingue uma ordem vazia de uma opção que não funcionou.
    const totalLinhas = Math.max(1, itens.length);
    const custoFechamento = temFechamento(ordem, itens, modo) ? alturaDoFechamento(ordem, modo) : 0;
    let cursor = 0;
    let continuacao = false;
    let fechamentoImpresso = custoFechamento === 0;

    while (cursor < totalLinhas) {
      const abertura = continuacao ? MM_ORDEM_CONTINUACAO : MM_ORDEM;
      let disponivel = limite() - usado - abertura - MM_ESPACO_ORDEM;

      // Viúva: não vale abrir uma OS no pé da folha para caber uma linha só.
      // O `min` poupa a ordem de item único de ser empurrada à toa.
      const minimo = Math.min(totalLinhas - cursor, 2) * MM_ITEM;
      if (disponivel < minimo && folha.length) {
        fechar();
        disponivel = limite() - abertura - MM_ESPACO_ORDEM;
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
        // Levar a última linha só imprime o fechamento se houver fechamento:
        // a OS sem valor nenhum termina na própria lista.
        levaFechamento = ultima && custoFechamento > 0;
      }

      // Guarda anti-laço: numa folha vazia entra pelo menos uma linha, mesmo
      // estourando o limite. O diário não tem esta guarda; sem ela, uma linha
      // mais alta que a folha inteira gira para sempre.
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
        ordem,
        linhas: itens.slice(cursor, cursor + cabem),
        continuacao,
        fecha: levaFechamento,
        primeiroIndice: cursor,
      });
      usado += abertura + altura + MM_ESPACO_ORDEM;
      cursor += cabem;
      continuacao = true;
      if (levaFechamento) fechamentoImpresso = true;
      // Fecha a folha só quando a OS de fato continua nela seguinte — nunca
      // porque a ordem acabou sem linha de fechamento.
      if (cursor < totalLinhas) fechar();
    }

    // Os itens fecharam a folha exatamente e o fechamento não coube: ele sai
    // sozinho na folha seguinte, sob o cabeçalho de continuação.
    if (!fechamentoImpresso) {
      const custo = MM_ORDEM_CONTINUACAO + alturaDoFechamento(ordem, modo) + MM_ESPACO_ORDEM;
      if (usado + custo > limite() && folha.length) fechar();
      folha.push({ ordem, linhas: [], continuacao: true, fecha: true, primeiroIndice: totalLinhas });
      usado += custo;
    }
  }

  fechar();
  return folhas.length ? folhas : [[]];
}
