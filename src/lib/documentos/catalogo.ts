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

const OS: GrupoVariaveis = {
  rotulo: "Ordem de serviço",
  variaveis: [
    v("os.numero", "Número da OS"),
    v("os.status", "Status"),
    v("os.setor", "Setor"),
    v("os.alvo", "O que foi atendido (veículo, peça ou equipamento)"),
    v("os.alvo_descricao", "Identificação do que foi atendido, em uma linha"),
    v("os.data_entrada", "Data de entrada"),
    v("os.previsao_saida", "Previsão de saída"),
    v("os.data_conclusao", "Data da conclusão do serviço"),
    v("os.data_saida", "Data de saída"),
    v("os.criado_por", "Quem abriu a OS"),
    v("os.descricao", "Descrição / problema relatado"),
    v("os.observacoes", "Observações"),
    v("os.garantia", "Garantia"),
    v("os.total_pecas", "Total de peças"),
    v("os.total_servicos", "Total de serviços"),
    v("os.subtotal", "Subtotal"),
    v("os.desconto", "Desconto"),
    v("os.frete", "Frete"),
    v("os.total", "Total"),
    v("os.total_extenso", "Total por extenso"),
    v("os.forma_pagamento", "Formas de pagamento, em uma linha"),
    v("os.pagamentos", "Formas de pagamento, em lista", "html"),
    v("os.pecas_tabela", "Tabela de peças pronta", "html"),
    v("os.servicos_tabela", "Tabela de serviços pronta", "html"),
  ],
};

const VEICULO: GrupoVariaveis = {
  rotulo: "Veículo",
  variaveis: [
    v("veiculo.placa", "Placa"),
    v("veiculo.marca", "Marca"),
    v("veiculo.modelo", "Modelo"),
    v("veiculo.ano", "Ano"),
    v("veiculo.cor", "Cor"),
    v("veiculo.km", "Quilometragem"),
    v("veiculo.chassi", "Chassi"),
    v("veiculo.renavam", "Renavam"),
    v("veiculo.combustivel", "Combustível"),
  ],
};

const PECA_E_EQUIPAMENTO: GrupoVariaveis = {
  rotulo: "Peça ou equipamento atendido",
  variaveis: [
    v("peca.titulo", "Peça: título"),
    v("peca.descricao", "Peça: descrição"),
    v("peca.lacre", "Peça: lacre"),
    v("equipamento.nome", "Equipamento: nome"),
    v("equipamento.patrimonio", "Equipamento: patrimônio"),
    v("equipamento.ano", "Equipamento: ano"),
    v("equipamento.horimetro", "Equipamento: horímetro"),
  ],
};

const CAMPOS_ITEM_OS = [
  v("numero", "Posição na lista (1, 2, 3…)"),
  v("codigo", "Código"),
  v("descricao", "Descrição"),
  v("quantidade", "Quantidade"),
  v("valor_unitario", "Valor unitário"),
  v("desconto", "Desconto"),
  v("total", "Total da linha"),
];

const PECAS_OS: ListaDocumento = {
  chave: "pecas",
  rotulo: "Peças da OS",
  item: "item",
  campos: [...CAMPOS_ITEM_OS, v("unidade", "Unidade")],
};

const SERVICOS_OS: ListaDocumento = {
  chave: "servicos",
  rotulo: "Serviços da OS",
  item: "item",
  campos: [...CAMPOS_ITEM_OS, v("realizadores", "Quem executou")],
};

const ALUGUEL: GrupoVariaveis = {
  rotulo: "Aluguel",
  variaveis: [
    v("aluguel.numero", "Número do aluguel"),
    v("aluguel.status", "Status"),
    v("aluguel.data_inicio", "Data de início"),
    v("aluguel.data_limite", "Data limite (ou \"Sem data limite\")"),
    v("aluguel.duracao", "Duração contratada"),
    v("aluguel.encerrado_em", "Data do encerramento"),
    v("aluguel.criado_por", "Quem registrou"),
    v("aluguel.destinatario", "Usuário interno que recebeu (quando não é cliente)"),
    v("aluguel.valor_total", "Valor total"),
    v("aluguel.valor_total_extenso", "Valor total por extenso"),
    v("aluguel.observacao", "Observação (texto formatado)", "html"),
    v("aluguel.itens_tabela", "Tabela de itens pronta", "html"),
  ],
};

const ITENS_ALUGUEL: ListaDocumento = {
  chave: "itens",
  rotulo: "Itens alugados",
  item: "item",
  campos: [
    v("numero", "Posição na lista (1, 2, 3…)"),
    v("tipo", "Tipo (produto, veículo, avulso…)"),
    v("descricao", "Descrição"),
    v("identificacao", "Identificação (série, placa…)"),
    v("quantidade", "Quantidade"),
    v("quantidade_devolvida", "Quantidade devolvida"),
    v("valor_unitario", "Valor unitário"),
    v("total", "Total da linha"),
    v("devolvido_em", "Data da devolução"),
  ],
};

/**
 * Exatamente uma das duas vale quando há cliente: sem tipo no cadastro, conta
 * o documento (14 dígitos é CNPJ). Sem cliente nenhuma vale.
 */
const CONDICOES_CLIENTE: CondicaoDocumento[] = [
  { chave: "se_pessoa_juridica", rotulo: "Só quando o cliente é pessoa jurídica (CNPJ)" },
  { chave: "se_pessoa_fisica", rotulo: "Só quando o cliente é pessoa física (CPF)" },
];

export const CATALOGOS: Record<ModuloDocumento, CatalogoModulo> = {
  venda: {
    modulo: "venda",
    grupos: [VENDA, CLIENTE, ENTREGA, EMPRESA, DOCUMENTO, PAGINA],
    listas: [ITENS_VENDA],
    condicoes: CONDICOES_CLIENTE,
  },
  os: {
    modulo: "os",
    grupos: [OS, CLIENTE, VEICULO, PECA_E_EQUIPAMENTO, EMPRESA, DOCUMENTO, PAGINA],
    listas: [PECAS_OS, SERVICOS_OS],
    condicoes: CONDICOES_CLIENTE,
  },
  aluguel: {
    modulo: "aluguel",
    grupos: [ALUGUEL, CLIENTE, EMPRESA, DOCUMENTO, PAGINA],
    listas: [ITENS_ALUGUEL],
    condicoes: CONDICOES_CLIENTE,
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
