import {
  arredondarMoeda,
  classificarItem,
  normalizarTexto,
  texto,
  type ClassificacaoItem,
  type MotivoClassificacao,
  type TipoItemHistorico,
} from "./garagepremium-orcamentos-lib";

// Os dois relatorios ("Pedidos de Venda" e "com Itens") saem do sistema
// anterior como uma unica tabela HTML 3.2 em Windows-1252.

export type OrdemLegada = {
  numero: string;
  data: string;
  hora: string;
  cliente: string;
  situacao: string;
  total: number;
  desconto: number;
  totalItens: number;
  cidade: string;
  estado: string;
  bairro: string;
};

export type ItemLegado = {
  numero: string;
  linhaOrigem: number;
  descricao: string;
  precoUnitario: number;
  quantidade: number;
  subtotal: number;
  mecanico: string;
};

export type ClassificacaoBrPecas = {
  tipo: TipoItemHistorico;
  motivo: MotivoClassificacao | "SERVICO_NO_LEGADO" | "PECA_RETIFICADOR";
};

export const SITUACOES_LEGADAS = [
  "Faturado",
  "Faturado Parcial",
  "Enviar para o Caixa",
  "Enviar para Expedição",
] as const;

const ENTIDADES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificarEntidades(valor: string) {
  return valor.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (original, codigo: string) => {
    if (codigo[0] === "#") {
      const numero = codigo[1] === "x" || codigo[1] === "X" ? parseInt(codigo.slice(2), 16) : parseInt(codigo.slice(1), 10);
      return Number.isFinite(numero) ? String.fromCodePoint(numero) : original;
    }
    return ENTIDADES[codigo.toLowerCase()] ?? original;
  });
}

/** Linhas da tabela, na ordem do arquivo; a primeira e o cabecalho. */
export function lerLinhasHtml(html: string) {
  const linhas: string[][] = [];
  for (const tr of html.matchAll(/<TR[^>]*>([\s\S]*?)<\/TR>/gi)) {
    const celulas = [...tr[1].matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map((td) =>
      decodificarEntidades(td[1].replace(/<[^>]+>/g, ""))
        .replace(/ /g, " ")
        .trim(),
    );
    linhas.push(celulas);
  }
  return linhas;
}

export function numeroBr(valor: string) {
  const limpo = valor.trim();
  if (!/^-?[\d.]*\d(,\d+)?$/.test(limpo)) throw new Error(`Número inválido no legado: "${valor}"`);
  return Number(limpo.replace(/\./g, "").replace(",", "."));
}

function exigirCabecalho(linha: string[] | undefined, esperado: string[], arquivo: string) {
  const atual = (linha ?? []).map((celula) => normalizarTexto(celula));
  const alvo = esperado.map((celula) => normalizarTexto(celula));
  if (atual.length !== alvo.length || atual.some((celula, i) => celula !== alvo[i])) {
    throw new Error(`Cabeçalho inesperado em ${arquivo}: ${(linha ?? []).join(" | ")}`);
  }
}

const CABECALHO_ORDENS = [
  "Número #", "Data", "Hora", "Cliente", "Vendedor", "Status", "Total",
  "Zona", "Cidade", "Estado", "Bairro", "DESCONTO", "TOTALITENS",
];

const CABECALHO_ITENS = [
  "", "Item", "Preço", "Qtd", "Qtd. Volume", "Total", "Qtd. Faturada", "Vendedor",
  "Status", "Nota", "Fabricante", "Zona", "Vendedor Peça", "Comissão Prc. Tabela",
  "Comissão Preço Venda", "FUNCPRODUCAO", "Custo", "CustoM", "RATEIODESCONTO",
  "TOTALPGTOS", "TOTALITENS123", "TOTALPRODUTOS", "TRANSPORTADORA", "BASECALCICMS",
];

/** A última linha é o rodapé de totais (contagem na coluna do número). */
export function lerOrdens(html: string): OrdemLegada[] {
  const [cabecalho, ...linhas] = lerLinhasHtml(html);
  exigirCabecalho(cabecalho, CABECALHO_ORDENS, "ordens_serviço.html");
  const rodape = linhas.filter((linha) => !linha[1]);
  if (rodape.length !== 1 || linhas[linhas.length - 1] !== rodape[0]) {
    throw new Error("A tabela de OS deveria ter exatamente um rodapé de totais, no fim.");
  }

  return linhas.slice(0, -1).map((linha) => {
    if (linha.length !== CABECALHO_ORDENS.length) throw new Error(`Linha de OS com ${linha.length} colunas.`);
    const [numero, data, hora, cliente, , situacao, total, , cidade, estado, bairro, desconto, totalItens] = linha;
    const dataBr = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!/^\d{7}$/.test(numero)) throw new Error(`Número de OS inválido: "${numero}"`);
    if (!dataBr || !/^\d{2}:\d{2}:\d{2}$/.test(hora)) throw new Error(`Data/hora inválida na OS ${numero}.`);
    if (!cliente) throw new Error(`OS ${numero} sem cliente.`);
    if (!(SITUACOES_LEGADAS as readonly string[]).includes(situacao)) {
      throw new Error(`Situação desconhecida na OS ${numero}: "${situacao}"`);
    }
    const valorDesconto = numeroBr(desconto);
    if (valorDesconto > 0) throw new Error(`Desconto positivo na OS ${numero}.`);
    return {
      numero,
      data: `${dataBr[3]}-${dataBr[2]}-${dataBr[1]}`,
      hora,
      cliente,
      situacao,
      total: numeroBr(total),
      desconto: Math.abs(valorDesconto),
      totalItens: numeroBr(totalItens),
      cidade,
      estado,
      bairro,
    };
  });
}

/**
 * Itens agrupados sob linhas "Pedido. : 0019036". O rodapé de totais é a
 * única linha de item sem descrição e fica de fora.
 */
export function lerItens(html: string): ItemLegado[] {
  const [cabecalho, ...linhas] = lerLinhasHtml(html);
  exigirCabecalho(cabecalho, CABECALHO_ITENS, "os_itens.html");
  const itens: ItemLegado[] = [];
  let numero: string | null = null;
  let rodapes = 0;

  linhas.forEach((linha, indice) => {
    // linha 1 = cabecalho; o legado nao repete o numero da OS nas linhas de item.
    const linhaOrigem = indice + 2;
    if (linha.length === 1) {
      const grupo = linha[0].match(/^Pedido\.\s*:\s*(\d{7})$/);
      if (!grupo) throw new Error(`Linha de agrupamento inesperada: "${linha[0]}"`);
      numero = grupo[1];
      return;
    }
    if (linha.length !== CABECALHO_ITENS.length) throw new Error(`Linha ${linhaOrigem} com ${linha.length} colunas.`);
    if (!linha[1]) {
      rodapes += 1;
      if (indice !== linhas.length - 1) throw new Error(`Item sem descrição fora do rodapé (linha ${linhaOrigem}).`);
      return;
    }
    if (!numero) throw new Error(`Item antes do primeiro agrupamento (linha ${linhaOrigem}).`);

    const precoUnitario = numeroBr(linha[2]);
    const quantidade = numeroBr(linha[3]);
    const subtotal = numeroBr(linha[5]);
    if (quantidade <= 0 || precoUnitario < 0) throw new Error(`Quantidade ou preço inválido na linha ${linhaOrigem}.`);
    if (arredondarMoeda(quantidade * precoUnitario) !== subtotal) {
      throw new Error(`Total do item não confere na linha ${linhaOrigem}: ${quantidade} × ${precoUnitario} ≠ ${subtotal}.`);
    }
    itens.push({
      numero,
      linhaOrigem,
      descricao: linha[1],
      precoUnitario,
      quantidade,
      subtotal,
      mecanico: linha[12],
    });
  });

  if (rodapes !== 1) throw new Error(`Esperado um rodapé na tabela de itens; encontrados ${rodapes}.`);
  return itens;
}

/**
 * O legado cadastrava quase tudo como produto; o único serviço de fato era o
 * CHECKLIST (é o que separa TOTALITENS123 de TOTALPRODUTOS). O resto segue a
 * mesma leitura de descrição usada na Garage Premium.
 */
export function classificarItemBrPecas(descricao: string): ClassificacaoBrPecas {
  const normalizada = normalizarTexto(descricao);
  if (/^CHECKLIST\b/.test(normalizada)) return { tipo: "SERVICO", motivo: "SERVICO_NO_LEGADO" };
  if (/^PINTURA\b/.test(normalizada)) return { tipo: "SERVICO", motivo: "ATIVIDADE" };
  if (/^RETIFICADOR\b/.test(normalizada)) return { tipo: "PRODUTO", motivo: "PECA_RETIFICADOR" };
  const { tipo, motivo }: ClassificacaoItem = classificarItem("", descricao);
  return { tipo, motivo };
}

export function ehConsumidorFinal(cliente: string) {
  return normalizarTexto(cliente) === "CONSUMIDOR FINAL";
}

export function moedaBr(valor: number) {
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type OrdemMontada = {
  numero: string;
  dataentrada: string;
  descricao: string;
  situacao: string;
  observacoes: string;
  consumidorFinal: boolean;
  clienteSnapshot: Record<string, string> | null;
  subtotal: number;
  desconto: number;
  orcamentototal: number;
  totalLegado: number;
  diferencaLegado: number;
  mecanicos: string[];
};

export function montarOrdem(ordem: OrdemLegada, itens: ItemLegado[]): OrdemMontada {
  if (!itens.length) throw new Error(`OS ${ordem.numero} sem itens.`);
  if (arredondarMoeda(ordem.totalItens - ordem.desconto) !== ordem.total) {
    throw new Error(`Total da OS ${ordem.numero} não confere com itens menos desconto no próprio legado.`);
  }

  const subtotal = arredondarMoeda(itens.reduce((soma, item) => soma + item.subtotal, 0));
  if (ordem.desconto > subtotal) throw new Error(`Desconto maior que os itens na OS ${ordem.numero}.`);
  const orcamentototal = arredondarMoeda(subtotal - ordem.desconto);
  const diferencaLegado = arredondarMoeda(ordem.total - orcamentototal);
  const mecanicos = [...new Set(itens.map((item) => item.mecanico).filter(Boolean))];
  const consumidorFinal = ehConsumidorFinal(ordem.cliente);

  const clienteSnapshot = consumidorFinal
    ? null
    : Object.fromEntries(
        Object.entries({
          nome: ordem.cliente,
          bairro: ordem.bairro,
          cidade: ordem.cidade,
          estado: ordem.estado,
        }).filter(([, valor]) => texto(valor)),
      );

  const observacoes = [
    `Registro legado: ${ordem.numero}`,
    `Situação no sistema anterior: ${ordem.situacao}`,
    mecanicos.length ? `Mecânicos no sistema anterior: ${mecanicos.join(", ")}` : null,
    diferencaLegado !== 0
      ? `Total no sistema anterior: ${moedaBr(ordem.total)} (os itens exportados somam ${moedaBr(orcamentototal)})`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    numero: ordem.numero,
    dataentrada: `${ordem.data}T${ordem.hora}-03:00`,
    descricao: `OS ${ordem.numero} do sistema anterior`,
    situacao: ordem.situacao,
    observacoes,
    consumidorFinal,
    clienteSnapshot,
    subtotal,
    desconto: ordem.desconto,
    orcamentototal,
    totalLegado: ordem.total,
    diferencaLegado,
    mecanicos,
  };
}
