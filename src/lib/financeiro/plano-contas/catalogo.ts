/**
 * Catálogo padrão de classificação de resultado.
 *
 * É a fonte única do significado financeiro de um grupo ou conta do plano de
 * contas. O nome exibido e o código visual variam por oficina; a chave aqui não
 * varia. Duas oficinas que chamem a mesma coisa de "Reparo de módulos" e
 * "Programação" apontam ambas para `RECEITA_SERVICOS` e produzem a mesma linha
 * na DRE.
 *
 * O que este arquivo NÃO faz: guardar a fórmula da DRE. A apresentação continua
 * em `dre_template`/`dre_linha`/`dre_mapeamento`. Aqui só existe o significado e
 * a linha de DETALHE de destino — nunca um subtotal, uma fórmula ou um grupo
 * com filhos, porque somar numa linha calculada duplicaria o valor.
 *
 * Versionamento: mudar o significado de uma chave existente exige subir
 * `CATALOGO_VERSAO`. Acrescentar chave nova também sobe a versão, mas não
 * reclassifica nada — a migração é idempotente por `codigo`.
 */

/** Família de compatibilidade. Uma conta só troca de família trocando de grupo. */
export type FamiliaClassificacao =
  | "RECEITA"
  | "DEDUCAO"
  | "CUSTO"
  | "DESPESA"
  | "FINANCEIRO"
  | "OUTROS_RESULTADOS"
  | "TRIBUTO_LUCRO"
  | "PATRIMONIAL";

/** Natureza do movimento de caixa aceita pela classificação. */
export type NaturezaMovimento = "RECEITA" | "DESPESA";

/** Papel na DRE. É diferente da natureza de caixa: desconto sai do caixa e deduz receita. */
export type PapelDre = "RECEITA" | "DEDUCAO" | "CUSTO" | "DESPESA";

export type TratamentoClassificacao = "RESULTADO" | "PATRIMONIAL";

export type Classificacao = {
  codigo: string;
  nome: string;
  descricao: string;
  familia: FamiliaClassificacao;
  tratamento: TratamentoClassificacao;
  /** Natureza de caixa que a classificação aceita. Vazio nunca: sem isso não há validação. */
  naturezas: NaturezaMovimento[];
  /** Papel na DRE. `null` apenas no tratamento patrimonial. */
  papelDre: PapelDre | null;
  /** Código da linha de DETALHE no template `PADRAO`. `null` apenas no patrimonial. */
  linhaCodigo: string | null;
  /** Obrigatório no patrimonial: por que o valor não compõe resultado. */
  motivoExclusao: string | null;
  /** Observação de implantação: o que ainda não tem origem automática. */
  observacao?: string;
};

export const CATALOGO_VERSAO = 1;

/**
 * Linhas de DETALHE do template `PADRAO` v1, incluindo as duas que a Fase 1
 * acrescenta (11.1 e 11.2). Serve de guarda: um destino fora desta lista é erro
 * de catálogo, não uma linha nova aceita em silêncio.
 */
export const LINHAS_DETALHE_PADRAO = [
  "1.1", "1.2", "1.3",
  "2.1", "2.2", "2.3", "2.4", "2.5",
  "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9",
  "6.1", "6.2", "6.3", "6.4", "6.5", "6.6",
  "8",
  "10.1", "10.2",
  "11.1", "11.2",
  "13.1", "13.2", "13.3",
] as const;

export const CLASSIFICACOES: Classificacao[] = [
  // ----------------------------------------------------------- receita bruta
  {
    codigo: "RECEITA_PRODUTOS",
    nome: "Receita de produtos",
    descricao: "Venda de peças, pneus, lubrificantes e demais mercadorias.",
    familia: "RECEITA",
    tratamento: "RESULTADO",
    naturezas: ["RECEITA"],
    papelDre: "RECEITA",
    linhaCodigo: "1.1",
    motivoExclusao: null,
  },
  {
    codigo: "RECEITA_SERVICOS",
    nome: "Receita de serviços",
    descricao: "Mão de obra, diagnóstico, reparo e demais serviços da oficina.",
    familia: "RECEITA",
    tratamento: "RESULTADO",
    naturezas: ["RECEITA"],
    papelDre: "RECEITA",
    linhaCodigo: "1.2",
    motivoExclusao: null,
  },
  {
    codigo: "RECEITA_FRETE",
    nome: "Frete cobrado do cliente",
    descricao: "Frete e entrega cobrados no documento, separados do preço do item.",
    familia: "RECEITA",
    tratamento: "RESULTADO",
    naturezas: ["RECEITA"],
    papelDre: "RECEITA",
    linhaCodigo: "1.3",
    motivoExclusao: null,
  },
  {
    codigo: "RECEITA_OPERACIONAL_OUTRA",
    nome: "Outras receitas da atividade",
    descricao: "Receita operacional que não é produto, serviço nem frete. Ex.: estacionamento, diária.",
    familia: "RECEITA",
    tratamento: "RESULTADO",
    naturezas: ["RECEITA"],
    papelDre: "RECEITA",
    linhaCodigo: "1.3",
    motivoExclusao: null,
  },

  // -------------------------------------------------------- deduções da receita
  {
    codigo: "TRIBUTO_RECEITA",
    nome: "Tributos sobre receita",
    descricao:
      "Tributo incidente sobre o faturamento — DAS, ISS, ICMS, PIS, COFINS. Não inclui tributo sobre o lucro nem taxa administrativa.",
    familia: "DEDUCAO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DEDUCAO",
    linhaCodigo: "2.1",
    motivoExclusao: null,
    observacao: "Sem apuração automática a partir das notas: depende do lançamento financeiro.",
  },
  {
    codigo: "DEVOLUCAO_COMERCIAL",
    nome: "Devoluções de vendas",
    descricao: "Retorno de mercadoria vendida, reduzindo a receita do período.",
    familia: "DEDUCAO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DEDUCAO",
    linhaCodigo: "2.2",
    motivoExclusao: null,
    observacao: "Sem geração automática nesta entrega: só chega por lançamento classificado.",
  },
  {
    codigo: "CANCELAMENTO_COMERCIAL",
    nome: "Cancelamentos comerciais",
    descricao: "Cancelamento de documento já reconhecido como receita.",
    familia: "DEDUCAO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DEDUCAO",
    linhaCodigo: "2.3",
    motivoExclusao: null,
    observacao:
      "O cancelamento da OS/venda já cancela os eventos originais. Lançar aqui em cima disso deduziria o mesmo fato duas vezes.",
  },
  {
    codigo: "ABATIMENTO_COMERCIAL",
    nome: "Abatimentos concedidos",
    descricao: "Redução acordada após a venda, sem devolução da mercadoria.",
    familia: "DEDUCAO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DEDUCAO",
    linhaCodigo: "2.4",
    motivoExclusao: null,
  },
  {
    codigo: "DESCONTO_INCONDICIONAL",
    nome: "Descontos concedidos na operação",
    descricao:
      "Desconto dado no próprio documento. Natureza de caixa DESPESA e papel DEDUCAO: sai do valor recebido e reduz a receita bruta.",
    familia: "DEDUCAO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DEDUCAO",
    linhaCodigo: "2.5",
    motivoExclusao: null,
  },

  // ------------------------------------------------------------------- custos
  {
    codigo: "CUSTO_MERCADORIA",
    nome: "Custo de mercadorias vendidas",
    descricao: "Custo das peças e mercadorias aplicadas ou revendidas.",
    familia: "CUSTO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "CUSTO",
    linhaCodigo: "4.1",
    motivoExclusao: null,
  },
  {
    codigo: "CUSTO_PRODUTO_FABRICADO",
    nome: "Custo de produtos fabricados",
    descricao: "Custo de produto produzido pela própria empresa. Só se aplica a quem fabrica.",
    familia: "CUSTO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "CUSTO",
    linhaCodigo: "4.2",
    motivoExclusao: null,
  },
  {
    codigo: "CUSTO_SERVICO",
    nome: "Custo dos serviços prestados",
    descricao: "Custo direto de execução do serviço, sem separar material e mão de obra.",
    familia: "CUSTO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "CUSTO",
    linhaCodigo: "4.3",
    motivoExclusao: null,
  },
  {
    codigo: "CUSTO_MATERIAL_DIRETO",
    nome: "Materiais aplicados",
    descricao: "Material de consumo aplicado diretamente no serviço.",
    familia: "CUSTO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "CUSTO",
    linhaCodigo: "4.4",
    motivoExclusao: null,
  },
  {
    codigo: "CUSTO_MAO_OBRA_DIRETA",
    nome: "Mão de obra direta",
    descricao: "Remuneração e comissão de quem executa o serviço vendido.",
    familia: "CUSTO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "CUSTO",
    linhaCodigo: "4.5",
    motivoExclusao: null,
    observacao:
      "As comissões de OS já chegam por evento próprio. Não reclassificar contas de comissão só pelo nome.",
  },
  {
    codigo: "CUSTO_TERCEIRO_DIRETO",
    nome: "Serviços terceirizados diretos",
    descricao: "Retífica, guincho e demais serviços contratados para executar a OS.",
    familia: "CUSTO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "CUSTO",
    linhaCodigo: "4.6",
    motivoExclusao: null,
  },
  {
    codigo: "CUSTO_DIRETO_OUTRO",
    nome: "Outros custos diretos",
    descricao: "Custo direto que não cabe nas linhas anteriores. Ex.: frete sobre compras, garantias.",
    familia: "CUSTO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "CUSTO",
    linhaCodigo: "4.7",
    motivoExclusao: null,
  },
  {
    codigo: "TRIBUTO_COMPRA_RESULTADO",
    nome: "Tributos de compra no resultado",
    descricao:
      "Tributo da nota de entrada que a política atual leva ao resultado do mês em vez do custo do estoque.",
    familia: "CUSTO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "CUSTO",
    linhaCodigo: "4.8",
    motivoExclusao: null,
    observacao:
      "Política gerencial existente, documentada em src/lib/nfe/tratamento-custo.ts. Revisão fiscal é dependência separada.",
  },
  {
    codigo: "RECUPERACAO_COMPRA",
    nome: "Recuperações e desonerações de compras",
    descricao:
      "Crédito ou desoneração que abate o custo. Natureza de caixa RECEITA, mas não é faturamento.",
    familia: "CUSTO",
    tratamento: "RESULTADO",
    naturezas: ["RECEITA"],
    papelDre: "CUSTO",
    linhaCodigo: "4.9",
    motivoExclusao: null,
  },

  // ------------------------------------------------------ despesas operacionais
  {
    codigo: "DESPESA_COMERCIAL",
    nome: "Despesas comerciais",
    descricao: "Marketing, publicidade, comissão de vendedor, taxas de marketplace, frete de venda.",
    familia: "DESPESA",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "6.1",
    motivoExclusao: null,
  },
  {
    codigo: "DESPESA_ADMINISTRATIVA",
    nome: "Despesas administrativas",
    descricao: "Contabilidade, jurídico, material de escritório, seguros, taxas administrativas.",
    familia: "DESPESA",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "6.2",
    motivoExclusao: null,
  },
  {
    codigo: "DESPESA_PESSOAL",
    nome: "Despesas com pessoal",
    descricao: "Salários, encargos, benefícios, pró-labore, rescisões.",
    familia: "DESPESA",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "6.3",
    motivoExclusao: null,
  },
  {
    codigo: "DESPESA_OCUPACAO",
    nome: "Ocupação e estrutura",
    descricao: "Aluguel, condomínio, energia, água, manutenção predial, consumo da oficina.",
    familia: "DESPESA",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "6.4",
    motivoExclusao: null,
  },
  {
    codigo: "DESPESA_TECNOLOGIA",
    nome: "Tecnologia",
    descricao: "Sistemas, hospedagem, internet, telefonia, certificado digital.",
    familia: "DESPESA",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "6.5",
    motivoExclusao: null,
  },
  {
    codigo: "DESPESA_OPERACIONAL_OUTRA",
    nome: "Outras despesas operacionais",
    descricao:
      "Despesa operacional identificada que não cabe nas anteriores. Não é destino de despesa desconhecida.",
    familia: "DESPESA",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "6.6",
    motivoExclusao: null,
  },
  {
    codigo: "DEPRECIACAO",
    nome: "Depreciação e amortização",
    descricao: "Depreciação registrada manualmente enquanto não existir módulo de patrimônio.",
    familia: "DESPESA",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "8",
    motivoExclusao: null,
    observacao: "Sem origem automática. Zero na linha não prova ausência de depreciação.",
  },

  // ----------------------------------------------------- resultado financeiro
  {
    codigo: "RECEITA_FINANCEIRA",
    nome: "Receitas financeiras",
    descricao: "Rendimento de aplicação, juros e multa recebidos de cliente, descontos obtidos.",
    familia: "FINANCEIRO",
    tratamento: "RESULTADO",
    naturezas: ["RECEITA"],
    papelDre: "RECEITA",
    linhaCodigo: "10.1",
    motivoExclusao: null,
  },
  {
    codigo: "DESPESA_FINANCEIRA",
    nome: "Despesas financeiras",
    descricao: "Tarifa bancária, taxa de cartão/PIX, antecipação de recebíveis, juros e multa pagos.",
    familia: "FINANCEIRO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "10.2",
    motivoExclusao: null,
  },

  // -------------------------------------------------------- outros resultados
  {
    codigo: "OUTRO_GANHO",
    nome: "Outros ganhos",
    descricao:
      "Ganho apurado fora da atividade. Na alienação de um bem, é a diferença entre o valor recebido e o valor contábil baixado — nunca o preço bruto.",
    familia: "OUTROS_RESULTADOS",
    tratamento: "RESULTADO",
    naturezas: ["RECEITA"],
    papelDre: "RECEITA",
    linhaCodigo: "11.1",
    motivoExclusao: null,
    observacao:
      "Sem módulo de patrimônio, o ganho não é apurável automaticamente: o recebimento fica pendente de complementação.",
  },
  {
    codigo: "OUTRA_PERDA",
    nome: "Outras perdas",
    descricao: "Perda apurada fora da atividade, inclusive baixa de ativo sem contrapartida de venda.",
    familia: "OUTROS_RESULTADOS",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "11.2",
    motivoExclusao: null,
  },

  // ------------------------------------------------------- tributos sobre lucro
  {
    codigo: "IRPJ_RESULTADO",
    nome: "IRPJ",
    descricao: "Imposto de renda da pessoa jurídica. Reduz o resultado, não a receita.",
    familia: "TRIBUTO_LUCRO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "13.1",
    motivoExclusao: null,
  },
  {
    codigo: "CSLL_RESULTADO",
    nome: "CSLL",
    descricao: "Contribuição social sobre o lucro líquido.",
    familia: "TRIBUTO_LUCRO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "13.2",
    motivoExclusao: null,
  },
  {
    codigo: "TRIBUTO_LUCRO_OUTRO",
    nome: "Outros tributos sobre o lucro",
    descricao: "Tributo equivalente ao IRPJ/CSLL em outro regime.",
    familia: "TRIBUTO_LUCRO",
    tratamento: "RESULTADO",
    naturezas: ["DESPESA"],
    papelDre: "DESPESA",
    linhaCodigo: "13.3",
    motivoExclusao: null,
  },

  // -------------------------------------------------------------- patrimonial
  {
    codigo: "PATRIMONIAL_SOCIOS",
    nome: "Sócios e patrimônio",
    descricao:
      "Aporte, integralização, distribuição de lucros e devolução de capital. Pró-labore NÃO entra aqui: é despesa com pessoal.",
    familia: "PATRIMONIAL",
    tratamento: "PATRIMONIAL",
    naturezas: ["RECEITA", "DESPESA"],
    papelDre: null,
    linhaCodigo: null,
    motivoExclusao: "Movimentação de patrimônio líquido: não é receita nem despesa do período.",
  },
  {
    codigo: "PATRIMONIAL_EMPRESTIMO",
    nome: "Empréstimos e financiamentos",
    descricao:
      "Principal recebido e amortizado. Juros e encargos vão para o resultado financeiro, não herdam esta exclusão.",
    familia: "PATRIMONIAL",
    tratamento: "PATRIMONIAL",
    naturezas: ["RECEITA", "DESPESA"],
    papelDre: null,
    linhaCodigo: null,
    motivoExclusao: "Principal de dívida: altera passivo e caixa, não o resultado.",
  },
  {
    codigo: "PATRIMONIAL_IMOBILIZADO",
    nome: "Aquisição de imobilizado",
    descricao:
      "Compra de máquinas, ferramentas de alto valor, veículos e obras. A despesa aparece depois, pela depreciação.",
    familia: "PATRIMONIAL",
    tratamento: "PATRIMONIAL",
    naturezas: ["RECEITA", "DESPESA"],
    papelDre: null,
    linhaCodigo: null,
    motivoExclusao: "Aquisição de ativo: troca caixa por bem, sem efeito no resultado do mês.",
  },
  {
    codigo: "TRANSFERENCIA_INTERNA",
    nome: "Transferências internas",
    descricao: "Movimento entre contas próprias, aplicação e resgate.",
    familia: "PATRIMONIAL",
    tratamento: "PATRIMONIAL",
    naturezas: ["RECEITA", "DESPESA"],
    papelDre: null,
    linhaCodigo: null,
    motivoExclusao: "O dinheiro muda de conta e continua sendo o mesmo dinheiro.",
  },
  {
    codigo: "ADIANTAMENTO",
    nome: "Adiantamentos",
    descricao: "Adiantamento de cliente ou a fornecedor, antes do fato que o consome.",
    familia: "PATRIMONIAL",
    tratamento: "PATRIMONIAL",
    naturezas: ["RECEITA", "DESPESA"],
    papelDre: null,
    linhaCodigo: null,
    motivoExclusao: "Direito ou obrigação: o resultado nasce quando o serviço ou a compra acontece.",
  },
];

/**
 * Grupo padrão do sistema. O `codigoSugerido` é uma preferência de exibição: se
 * já existir um grupo local com esse código, a instalação escolhe outro livre.
 * Nunca sobrescreve cadastro existente.
 */
export type GrupoPadrao = {
  codigo: string;
  nome: string;
  codigoSugerido: string;
  classificacao: string;
};

export const GRUPOS_PADRAO: GrupoPadrao[] = [
  { codigo: "GRP_RECEITA_PRODUTOS", nome: "Receitas de produtos", codigoSugerido: "S1", classificacao: "RECEITA_PRODUTOS" },
  { codigo: "GRP_RECEITA_SERVICOS", nome: "Receitas de serviços", codigoSugerido: "S2", classificacao: "RECEITA_SERVICOS" },
  { codigo: "GRP_RECEITA_OUTRAS", nome: "Outras receitas da atividade", codigoSugerido: "S3", classificacao: "RECEITA_OPERACIONAL_OUTRA" },
  { codigo: "GRP_TRIBUTO_RECEITA", nome: "Tributos sobre receita", codigoSugerido: "S4", classificacao: "TRIBUTO_RECEITA" },
  { codigo: "GRP_DEDUCAO_COMERCIAL", nome: "Deduções comerciais", codigoSugerido: "S5", classificacao: "DESCONTO_INCONDICIONAL" },
  { codigo: "GRP_CUSTO_MERCADORIA", nome: "Custo de mercadorias", codigoSugerido: "S6", classificacao: "CUSTO_MERCADORIA" },
  { codigo: "GRP_CUSTO_SERVICO", nome: "Custos de serviços", codigoSugerido: "S7", classificacao: "CUSTO_SERVICO" },
  { codigo: "GRP_DESPESA_COMERCIAL", nome: "Despesas comerciais", codigoSugerido: "S8", classificacao: "DESPESA_COMERCIAL" },
  { codigo: "GRP_DESPESA_ADMINISTRATIVA", nome: "Despesas administrativas", codigoSugerido: "S9", classificacao: "DESPESA_ADMINISTRATIVA" },
  { codigo: "GRP_DESPESA_PESSOAL", nome: "Despesas com pessoal", codigoSugerido: "S10", classificacao: "DESPESA_PESSOAL" },
  { codigo: "GRP_DESPESA_OCUPACAO", nome: "Ocupação e estrutura", codigoSugerido: "S11", classificacao: "DESPESA_OCUPACAO" },
  { codigo: "GRP_DESPESA_TECNOLOGIA", nome: "Tecnologia", codigoSugerido: "S12", classificacao: "DESPESA_TECNOLOGIA" },
  { codigo: "GRP_DESPESA_OPERACIONAL_OUTRA", nome: "Outras despesas operacionais", codigoSugerido: "S22", classificacao: "DESPESA_OPERACIONAL_OUTRA" },
  { codigo: "GRP_DEPRECIACAO", nome: "Depreciação e amortização", codigoSugerido: "S23", classificacao: "DEPRECIACAO" },
  { codigo: "GRP_FINANCEIRO_RECEITA", nome: "Receitas financeiras", codigoSugerido: "S13", classificacao: "RECEITA_FINANCEIRA" },
  { codigo: "GRP_FINANCEIRO_DESPESA", nome: "Despesas financeiras", codigoSugerido: "S14", classificacao: "DESPESA_FINANCEIRA" },
  { codigo: "GRP_OUTROS_RESULTADOS", nome: "Outros ganhos e perdas", codigoSugerido: "S15", classificacao: "OUTRO_GANHO" },
  { codigo: "GRP_TRIBUTO_LUCRO", nome: "Tributos sobre o lucro", codigoSugerido: "S16", classificacao: "IRPJ_RESULTADO" },
  { codigo: "GRP_PATRIMONIAL_SOCIOS", nome: "Sócios e patrimônio", codigoSugerido: "S17", classificacao: "PATRIMONIAL_SOCIOS" },
  { codigo: "GRP_PATRIMONIAL_EMPRESTIMO", nome: "Empréstimos e financiamentos", codigoSugerido: "S18", classificacao: "PATRIMONIAL_EMPRESTIMO" },
  { codigo: "GRP_PATRIMONIAL_IMOBILIZADO", nome: "Investimentos e imobilizado", codigoSugerido: "S19", classificacao: "PATRIMONIAL_IMOBILIZADO" },
  { codigo: "GRP_TRANSFERENCIA", nome: "Transferências internas", codigoSugerido: "S20", classificacao: "TRANSFERENCIA_INTERNA" },
  { codigo: "GRP_ADIANTAMENTO", nome: "Adiantamentos", codigoSugerido: "S21", classificacao: "ADIANTAMENTO" },
];

/**
 * Conta padrão. `instalacao` separa a base mínima — o que uma oficina nova
 * recebe — das contas oferecidas sob demanda, para não despejar centenas de
 * linhas em quem não usa.
 *
 * `classificacao` só aparece quando a conta diverge do padrão do grupo. Uma
 * conta sem exceção herda o grupo: é o caso comum e o que a tela explica.
 */
export type ContaPadrao = {
  codigo: string;
  nome: string;
  grupo: string;
  instalacao: "BASE" | "OPCIONAL";
  classificacao?: string;
};

export const CONTAS_PADRAO: ContaPadrao[] = [
  { codigo: "CTA_VENDA_PECAS", nome: "Venda de peças", grupo: "GRP_RECEITA_PRODUTOS", instalacao: "BASE" },
  { codigo: "CTA_SERVICO_OFICINA", nome: "Serviços de oficina", grupo: "GRP_RECEITA_SERVICOS", instalacao: "BASE" },
  { codigo: "CTA_FRETE_COBRADO", nome: "Frete cobrado", grupo: "GRP_RECEITA_OUTRAS", instalacao: "BASE", classificacao: "RECEITA_FRETE" },
  { codigo: "CTA_RECEITA_OPERACIONAL_OUTRA", nome: "Outras receitas operacionais", grupo: "GRP_RECEITA_OUTRAS", instalacao: "OPCIONAL" },
  { codigo: "CTA_TRIBUTO_VENDAS", nome: "Tributos sobre vendas e serviços", grupo: "GRP_TRIBUTO_RECEITA", instalacao: "BASE" },
  { codigo: "CTA_DAS", nome: "Simples Nacional (DAS)", grupo: "GRP_TRIBUTO_RECEITA", instalacao: "OPCIONAL" },
  { codigo: "CTA_ISS", nome: "ISS", grupo: "GRP_TRIBUTO_RECEITA", instalacao: "OPCIONAL" },
  { codigo: "CTA_ICMS", nome: "ICMS", grupo: "GRP_TRIBUTO_RECEITA", instalacao: "OPCIONAL" },
  { codigo: "CTA_PIS", nome: "PIS", grupo: "GRP_TRIBUTO_RECEITA", instalacao: "OPCIONAL" },
  { codigo: "CTA_COFINS", nome: "COFINS", grupo: "GRP_TRIBUTO_RECEITA", instalacao: "OPCIONAL" },
  { codigo: "CTA_DESCONTO_CONCEDIDO", nome: "Descontos concedidos na operação", grupo: "GRP_DEDUCAO_COMERCIAL", instalacao: "BASE" },
  { codigo: "CTA_DEVOLUCAO", nome: "Devoluções comerciais", grupo: "GRP_DEDUCAO_COMERCIAL", instalacao: "OPCIONAL", classificacao: "DEVOLUCAO_COMERCIAL" },
  { codigo: "CTA_ABATIMENTO", nome: "Abatimentos concedidos", grupo: "GRP_DEDUCAO_COMERCIAL", instalacao: "OPCIONAL", classificacao: "ABATIMENTO_COMERCIAL" },
  { codigo: "CTA_CANCELAMENTO", nome: "Cancelamentos comerciais", grupo: "GRP_DEDUCAO_COMERCIAL", instalacao: "OPCIONAL", classificacao: "CANCELAMENTO_COMERCIAL" },
  { codigo: "CTA_MERCADORIA_VENDIDA", nome: "Mercadorias aplicadas/vendidas", grupo: "GRP_CUSTO_MERCADORIA", instalacao: "BASE" },
  { codigo: "CTA_TRIBUTO_ENTRADA", nome: "Tributos de entrada no resultado", grupo: "GRP_CUSTO_MERCADORIA", instalacao: "OPCIONAL", classificacao: "TRIBUTO_COMPRA_RESULTADO" },
  { codigo: "CTA_RECUPERACAO_COMPRA", nome: "Recuperações e desonerações", grupo: "GRP_CUSTO_MERCADORIA", instalacao: "OPCIONAL", classificacao: "RECUPERACAO_COMPRA" },
  { codigo: "CTA_CUSTO_SERVICO", nome: "Custos dos serviços", grupo: "GRP_CUSTO_SERVICO", instalacao: "BASE" },
  { codigo: "CTA_MATERIAL_APLICADO", nome: "Materiais aplicados", grupo: "GRP_CUSTO_SERVICO", instalacao: "BASE", classificacao: "CUSTO_MATERIAL_DIRETO" },
  { codigo: "CTA_MAO_OBRA_DIRETA", nome: "Mão de obra direta", grupo: "GRP_CUSTO_SERVICO", instalacao: "OPCIONAL", classificacao: "CUSTO_MAO_OBRA_DIRETA" },
  { codigo: "CTA_TERCEIRIZACAO_DIRETA", nome: "Terceirização direta", grupo: "GRP_CUSTO_SERVICO", instalacao: "BASE", classificacao: "CUSTO_TERCEIRO_DIRETO" },
  { codigo: "CTA_CUSTO_DIRETO_OUTRO", nome: "Outros custos diretos", grupo: "GRP_CUSTO_SERVICO", instalacao: "OPCIONAL", classificacao: "CUSTO_DIRETO_OUTRO" },
  { codigo: "CTA_PRODUTO_FABRICADO", nome: "Produtos fabricados", grupo: "GRP_CUSTO_SERVICO", instalacao: "OPCIONAL", classificacao: "CUSTO_PRODUTO_FABRICADO" },
  { codigo: "CTA_DESPESA_COMERCIAL", nome: "Despesas comerciais gerais", grupo: "GRP_DESPESA_COMERCIAL", instalacao: "BASE" },
  { codigo: "CTA_DESPESA_ADMINISTRATIVA", nome: "Despesas administrativas gerais", grupo: "GRP_DESPESA_ADMINISTRATIVA", instalacao: "BASE" },
  { codigo: "CTA_SALARIOS_ENCARGOS", nome: "Salários e encargos", grupo: "GRP_DESPESA_PESSOAL", instalacao: "BASE" },
  { codigo: "CTA_PRO_LABORE", nome: "Pró-labore", grupo: "GRP_DESPESA_PESSOAL", instalacao: "OPCIONAL" },
  { codigo: "CTA_ALUGUEL_OCUPACAO", nome: "Aluguel e ocupação", grupo: "GRP_DESPESA_OCUPACAO", instalacao: "BASE" },
  { codigo: "CTA_SISTEMAS", nome: "Sistemas e tecnologia", grupo: "GRP_DESPESA_TECNOLOGIA", instalacao: "BASE" },
  { codigo: "CTA_DESPESA_OPERACIONAL_OUTRA", nome: "Despesas operacionais gerais", grupo: "GRP_DESPESA_OPERACIONAL_OUTRA", instalacao: "OPCIONAL" },
  { codigo: "CTA_DEPRECIACAO", nome: "Depreciação registrada", grupo: "GRP_DEPRECIACAO", instalacao: "OPCIONAL" },
  { codigo: "CTA_JUROS_RENDIMENTOS", nome: "Juros e rendimentos", grupo: "GRP_FINANCEIRO_RECEITA", instalacao: "BASE" },
  { codigo: "CTA_TARIFAS_ENCARGOS", nome: "Tarifas e encargos", grupo: "GRP_FINANCEIRO_DESPESA", instalacao: "BASE" },
  { codigo: "CTA_GANHO_OUTRO", nome: "Ganhos em outras operações", grupo: "GRP_OUTROS_RESULTADOS", instalacao: "OPCIONAL" },
  { codigo: "CTA_PERDA_OUTRA", nome: "Perdas em outras operações", grupo: "GRP_OUTROS_RESULTADOS", instalacao: "OPCIONAL", classificacao: "OUTRA_PERDA" },
  { codigo: "CTA_IRPJ", nome: "IRPJ", grupo: "GRP_TRIBUTO_LUCRO", instalacao: "OPCIONAL" },
  { codigo: "CTA_CSLL", nome: "CSLL", grupo: "GRP_TRIBUTO_LUCRO", instalacao: "OPCIONAL", classificacao: "CSLL_RESULTADO" },
  { codigo: "CTA_TRIBUTO_LUCRO_OUTRO", nome: "Tributos equivalentes", grupo: "GRP_TRIBUTO_LUCRO", instalacao: "OPCIONAL", classificacao: "TRIBUTO_LUCRO_OUTRO" },
  { codigo: "CTA_SOCIOS", nome: "Aportes e distribuições", grupo: "GRP_PATRIMONIAL_SOCIOS", instalacao: "BASE" },
  { codigo: "CTA_EMPRESTIMO_PRINCIPAL", nome: "Principal de empréstimos", grupo: "GRP_PATRIMONIAL_EMPRESTIMO", instalacao: "BASE" },
  { codigo: "CTA_IMOBILIZADO", nome: "Aquisição de equipamentos", grupo: "GRP_PATRIMONIAL_IMOBILIZADO", instalacao: "BASE" },
  { codigo: "CTA_TRANSFERENCIA", nome: "Transferência entre contas", grupo: "GRP_TRANSFERENCIA", instalacao: "BASE" },
  { codigo: "CTA_ADIANTAMENTO", nome: "Adiantamentos de clientes/fornecedores", grupo: "GRP_ADIANTAMENTO", instalacao: "BASE" },
];

const PORCODIGO = new Map(CLASSIFICACOES.map((c) => [c.codigo, c]));

export function classificacaoPorCodigo(codigo: string) {
  return PORCODIGO.get(codigo) ?? null;
}

/** Classificação efetiva de uma conta: exceção da conta, senão padrão do grupo. */
export function classificacaoEfetiva(conta: ContaPadrao) {
  const grupo = GRUPOS_PADRAO.find((g) => g.codigo === conta.grupo);
  return conta.classificacao ?? grupo?.classificacao ?? null;
}

/** A natureza de caixa é aceita por esta classificação? */
export function naturezaCompativel(codigo: string, natureza: NaturezaMovimento) {
  const classificacao = PORCODIGO.get(codigo);
  return classificacao ? classificacao.naturezas.includes(natureza) : false;
}
