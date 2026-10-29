// O que cada módulo entrega aos modelos. É a lista que a tela de edição mostra
// e a régua do motor: variável fora daqui fica escrita no documento.
// `contexto.ts` monta exatamente estas chaves; o teste confere as duas pontas.

import type {
  CatalogoModulo,
  CondicaoDocumento,
  GrupoVariaveis,
  ListaDocumento,
  ModuloDocumento,
  VariavelDocumento,
} from "./tipos";

const v = (chave: string, rotulo: string, tipo?: VariavelDocumento["tipo"]): VariavelDocumento =>
  tipo ? { chave, rotulo, tipo } : { chave, rotulo };

const EMPRESA: GrupoVariaveis = {
  rotulo: "Empresa",
  variaveis: [
    v("empresa.nome", "Nome fantasia (ou razão social)"),
    v("empresa.razao_social", "Razão social"),
    v("empresa.cnpj", "CNPJ"),
    v("empresa.inscricao_estadual", "Inscrição estadual"),
    v("empresa.inscricao_municipal", "Inscrição municipal"),
    v("empresa.telefone", "Telefone"),
    v("empresa.endereco", "Endereço completo"),
    v("empresa.bairro", "Bairro"),
    v("empresa.cidade", "Cidade"),
    v("empresa.uf", "UF"),
    v("empresa.cep", "CEP"),
    v("empresa.logo", "Logo (imagem pronta)", "html"),
    v("empresa.logo_url", "Endereço da logo, para usar em <img src>"),
  ],
};

const DOCUMENTO: GrupoVariaveis = {
  rotulo: "Emissão",
  variaveis: [
    v("documento.nome", "Nome deste documento"),
    v("documento.data_emissao", "Data da emissão (14/10/2026)"),
    v("documento.data_emissao_extenso", "Data da emissão por extenso (14 de outubro de 2026)"),
    v("documento.hora_emissao", "Data e hora da emissão"),
    v("documento.emitido_por", "Usuário que emitiu"),
  ],
};

/**
 * Número da folha. Só tem sentido dentro do rodapé ou do cabeçalho repetidos
 * (`data-documento="rodape"` / `"cabecalho"`): a paginação da folha A4 é que
 * preenche cada um.
 */
const PAGINA: GrupoVariaveis = {
  rotulo: "Paginação",
  variaveis: [
    v("pagina.atual", "Número desta folha (use no rodapé ou no cabeçalho)", "html"),
    v("pagina.total", "Total de folhas", "html"),
  ],
};

const CLIENTE: GrupoVariaveis = {
  rotulo: "Cliente",
  variaveis: [
    v("cliente.nome", "Nome ou razão social"),
    v("cliente.documento", "CPF ou CNPJ"),
    v("cliente.tipo_pessoa", "Pessoa física ou jurídica"),
    v("cliente.inscricao_estadual", "Inscrição estadual"),
    v("cliente.email", "E-mail"),
    v("cliente.telefone", "Telefone"),
    v("cliente.endereco_completo", "Endereço completo"),
    v("cliente.logradouro", "Logradouro"),
    v("cliente.numero", "Número"),
    v("cliente.complemento", "Complemento"),
    v("cliente.bairro", "Bairro"),
    v("cliente.cidade", "Cidade"),
    v("cliente.uf", "UF"),
    v("cliente.cep", "CEP"),
  ],
};

const VENDA: GrupoVariaveis = {
  rotulo: "Venda",
  variaveis: [
    v("venda.numero", "Número da venda"),
    v("venda.data", "Data da venda"),
    v("venda.data_hora", "Data e hora da venda"),
    v("venda.ano", "Ano da venda (2026)"),
    v("venda.ano_curto", "Ano da venda com dois dígitos (26)"),
    v("venda.status", "Status"),
    v("venda.canal", "Canal"),
    v("venda.categoria", "Categoria"),
    v("venda.vendedor", "Vendedor"),
    v("venda.criado_por", "Quem registrou"),
    v("venda.quantidade_itens", "Quantidade de itens"),
    v("venda.subtotal", "Subtotal dos itens"),
    v("venda.desconto", "Descontos (itens e geral)"),
    v("venda.frete", "Frete"),
    v("venda.acrescimo", "Acréscimo financeiro"),
    v("venda.total", "Total"),
    v("venda.total_extenso", "Total por extenso"),
    v("venda.forma_pagamento", "Formas de pagamento, em uma linha"),
    v("venda.pagamentos", "Formas de pagamento, em lista", "html"),
    v("venda.garantia", "Garantia"),
    v("venda.descricao", "Descrição"),
    v("venda.observacoes", "Observações"),
    v("venda.nfe_chave", "Chave da NF-e"),
    v("venda.itens_tabela", "Tabela de itens pronta", "html"),
  ],
};

const ENTREGA: GrupoVariaveis = {
  rotulo: "Entrega",
  variaveis: [
    v("entrega.metodo", "Forma de entrega"),
    v("entrega.endereco", "Endereço de entrega"),
    v("entrega.rastreio", "Código de rastreio"),
    v("entrega.transportadora", "Transportadora"),
  ],
};

const ITENS_VENDA: ListaDocumento = {
  chave: "itens",
  rotulo: "Itens da venda",
  item: "item",
  campos: [
    v("numero", "Posição na lista (1, 2, 3…)"),
    v("codigo", "Código do produto"),
    v("descricao", "Descrição"),
    v("unidade", "Unidade"),
    v("quantidade", "Quantidade"),
    v("valor_unitario", "Valor unitário"),
    v("desconto", "Desconto"),
    v("total", "Total da linha"),
  ],
};

/**
 * Exatamente uma das três vale: com cliente, jurídica ou física (sem tipo no
 * cadastro, conta o documento: 14 dígitos é CNPJ); sem cliente, a última.
 */
const CONDICOES_CLIENTE: CondicaoDocumento[] = [
  { chave: "se_pessoa_juridica", rotulo: "Só quando o cliente é pessoa jurídica (CNPJ)" },
  { chave: "se_pessoa_fisica", rotulo: "Só quando o cliente é pessoa física (CPF)" },
  { chave: "se_sem_cliente", rotulo: "Só quando não há cliente identificado" },
];

/** Linhas de total que só aparecem quando há valor, como no cupom. */
const CONDICOES_VENDA: CondicaoDocumento[] = [
  { chave: "se_desconto", rotulo: "Só quando a venda tem desconto" },
  { chave: "se_frete", rotulo: "Só quando a venda tem frete" },
  { chave: "se_acrescimo", rotulo: "Só quando a venda tem acréscimo financeiro" },
];

export const CATALOGOS: Record<ModuloDocumento, CatalogoModulo> = {
  venda: {
    modulo: "venda",
    grupos: [VENDA, CLIENTE, ENTREGA, EMPRESA, DOCUMENTO, PAGINA],
    listas: [ITENS_VENDA],
    condicoes: [...CONDICOES_CLIENTE, ...CONDICOES_VENDA],
  },
};

/**
 * Trechos de estrutura da folha A4, entendidos pela paginação: o que repete
 * em toda folha e onde forçar uma folha nova.
 */
export const TRECHOS_DA_FOLHA = [
  {
    rotulo: "Rodapé em toda folha",
    descricao: "Repete no pé de cada folha, com o número da página.",
    trecho:
      `<footer data-documento="rodape" style="border-top:1px solid #cbd5e1;padding-top:6px;font-size:10px;color:#475569;text-align:center">
  {{empresa.nome}} · CNPJ {{empresa.cnpj}} · Página {{pagina.atual}} de {{pagina.total}}
</footer>`,
  },
  {
    rotulo: "Cabeçalho em toda folha",
    descricao: "Repete no topo de cada folha.",
    trecho:
      `<header data-documento="cabecalho" style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #cbd5e1;padding-bottom:6px;margin-bottom:12px">
  {{empresa.logo}}
  <strong>{{empresa.nome}}</strong>
</header>`,
  },
  {
    rotulo: "Quebra de folha",
    descricao: "O que vem depois começa numa folha nova.",
    trecho: '<div data-documento="quebra"></div>',
  },
] as const;

/** Bloco pronto para colar no editor ao clicar numa condição. */
export function trechoDaCondicao(condicao: CondicaoDocumento) {
  return `{{#${condicao.chave}}}texto{{/${condicao.chave}}}`;
}

/** Bloco pronto para colar no editor ao clicar numa lista. */
export function trechoDaLista(lista: ListaDocumento) {
  const campos = lista.campos.filter((c) => c.chave !== "numero").slice(0, 3);
  return `{{#${lista.chave}}}\n  <tr>${campos.map((c) => `<td>{{${lista.item}.${c.chave}}}</td>`).join("")}</tr>\n{{/${lista.chave}}}`;
}
