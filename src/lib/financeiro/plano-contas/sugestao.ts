/**
 * Sugestão de classificação para os cadastros existentes.
 *
 * Serve à migração da Entrega A: propor, com justificativa e grau de certeza, a
 * qual classificação do catálogo cada grupo/conta já cadastrado corresponde.
 *
 * O que este módulo NÃO é: um classificador. Nome é indício, não identidade —
 * foi exatamente assim que IRPJ e CSLL foram parar em dedução da receita, por
 * uma regra de palavra-chave no nome do grupo. Por isso:
 *
 * - toda sugestão carrega `certeza` e `justificativa`;
 * - o que muda o destino atual sai marcado, para ser conferido antes de aplicar;
 * - o que é genuinamente ambíguo devolve `null` e vira pendência, nunca um
 *   palpite silencioso;
 * - "Despesas não identificadas" continua sem classificação, porque identificar
 *   é trabalho de quem conhece o lançamento.
 */
import { CLASSIFICACOES } from "./catalogo";

export type Certeza = "ALTA" | "MEDIA" | "BAIXA" | "NENHUMA";

export type Sugestao = {
  /** Chave do catálogo, ou `null` quando a decisão é humana. */
  classificacao: string | null;
  certeza: Certeza;
  justificativa: string;
  /** Verdadeiro sempre que aplicar sem conferência seria irresponsável. */
  exigeRevisao: boolean;
};

/** Remove acento, caixa e espaço redundante. Não remove palavra nem ordena. */
export function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Contas cujo significado depende do grupo em que estão. A chave é
 * `nome@@grupo`, ambos normalizados, e vence qualquer regra por nome puro.
 */
const POR_NOME_E_GRUPO: Record<string, string> = {
  // "Descontos concedidos" deduz receita quando é comercial e é despesa
  // financeira quando é desconto de pagamento antecipado.
  "descontos concedidos@@deducoes de receita": "DESCONTO_INCONDICIONAL",
  "descontos concedidos@@despesas financeiras": "DESPESA_FINANCEIRA",
  // Sucata vendida pela oficina é receita da atividade, não resultado financeiro.
  "venda de sucata@@receitas financeiras e outras receitas": "RECEITA_OPERACIONAL_OUTRA",
  "venda de sucata@@receitas financeiras": "RECEITA_OPERACIONAL_OUTRA",
  // Mão de obra terceirizada aplicada na OS é custo; na folha, é pessoal.
  "mao de obra terceirizada@@custos diretos": "CUSTO_TERCEIRO_DIRETO",
  "mao de obra terceirizada@@pessoal": "DESPESA_PESSOAL",
};

/** Contas cujo nome já identifica o significado, independentemente do grupo. */
const POR_NOME: Record<string, string> = {
  // ------------------------------------------------------- receita de serviços
  "mao de obra": "RECEITA_SERVICOS",
  "mao de obra mecanica": "RECEITA_SERVICOS",
  "servicos mecanicos": "RECEITA_SERVICOS",
  "servicos eletricos": "RECEITA_SERVICOS",
  "diagnostico automotivo": "RECEITA_SERVICOS",
  "diagnostico e avaliacao": "RECEITA_SERVICOS",
  "injecao eletronica": "RECEITA_SERVICOS",
  "funilaria e pintura": "RECEITA_SERVICOS",
  "alinhamento e balanceamento": "RECEITA_SERVICOS",
  "instalacao de pecas": "RECEITA_SERVICOS",
  "instalacao de pecas e acessorios": "RECEITA_SERVICOS",
  "outros servicos da oficina": "RECEITA_SERVICOS",
  "servicos terceirizados faturados": "RECEITA_SERVICOS",
  "servico de programacao": "RECEITA_SERVICOS",
  "servico reparo bico/unidade": "RECEITA_SERVICOS",
  "servico reparo de modulo": "RECEITA_SERVICOS",
  "teste de bomba": "RECEITA_SERVICOS",
  "servico de guincho": "RECEITA_SERVICOS",

  // ------------------------------------------------------- receita de produtos
  "venda de pecas": "RECEITA_PRODUTOS",
  "venda de pecas novas": "RECEITA_PRODUTOS",
  "venda de pecas usadas": "RECEITA_PRODUTOS",
  "venda de pneus": "RECEITA_PRODUTOS",
  "venda de lubrificantes e fluidos": "RECEITA_PRODUTOS",
  "venda de acessorios": "RECEITA_PRODUTOS",
  "venda de produtos diversos": "RECEITA_PRODUTOS",
  "venda de veiculos": "RECEITA_PRODUTOS",
  "venda de veiculos de repasse": "RECEITA_PRODUTOS",

  // -------------------------------------------------- outras receitas e frete
  "frete e entrega cobrados": "RECEITA_FRETE",
  "estacionamento e diaria": "RECEITA_OPERACIONAL_OUTRA",
  "outras receitas operacionais": "RECEITA_OPERACIONAL_OUTRA",
  "venda de sucata e reciclaveis": "RECEITA_OPERACIONAL_OUTRA",

  // ---------------------------------------------------- deduções e devoluções
  "descontos concedidos na operacao": "DESCONTO_INCONDICIONAL",
  "devolucoes de vendas": "DEVOLUCAO_COMERCIAL",
  "cancelamentos de servicos": "CANCELAMENTO_COMERCIAL",
  "impostos sobre vendas e servicos": "TRIBUTO_RECEITA",

  // ---------------------------------------------------- tributos sobre receita
  "simples nacional": "TRIBUTO_RECEITA",
  "simples nacional - das": "TRIBUTO_RECEITA",
  icms: "TRIBUTO_RECEITA",
  iss: "TRIBUTO_RECEITA",
  pis: "TRIBUTO_RECEITA",
  cofins: "TRIBUTO_RECEITA",
  cbs: "TRIBUTO_RECEITA",
  ibs: "TRIBUTO_RECEITA",
  "imposto seletivo": "TRIBUTO_RECEITA",

  // ------------------------------------------------------ tributos sobre lucro
  irpj: "IRPJ_RESULTADO",
  csll: "CSLL_RESULTADO",

  // ------------------------------------------------------------------- custos
  "compra de pecas para revenda": "CUSTO_MERCADORIA",
  "compra de pecas para ordem de servico": "CUSTO_MERCADORIA",
  "compra de lubrificantes e fluidos": "CUSTO_MERCADORIA",
  "compra de veiculos para revenda": "CUSTO_MERCADORIA",
  "compra de veiculos para desmontagem": "CUSTO_MERCADORIA",
  "compra de sucatas e lotes": "CUSTO_MERCADORIA",
  "custo das mercadorias vendidas": "CUSTO_MERCADORIA",
  "custo dos servicos prestados": "CUSTO_SERVICO",
  "materiais aplicados em servicos": "CUSTO_MATERIAL_DIRETO",
  "materiais aplicados nos servicos": "CUSTO_MATERIAL_DIRETO",
  "lubrificantes e fluidos aplicados": "CUSTO_MATERIAL_DIRETO",
  "tintas e materiais de pintura": "CUSTO_MATERIAL_DIRETO",
  "servicos terceirizados": "CUSTO_TERCEIRO_DIRETO",
  "servicos terceirizados em veiculos": "CUSTO_TERCEIRO_DIRETO",
  "retifica e usinagem terceirizada": "CUSTO_TERCEIRO_DIRETO",
  "guincho contratado para cliente": "CUSTO_TERCEIRO_DIRETO",
  "comissao de terceiros": "CUSTO_TERCEIRO_DIRETO",
  "frete sobre compras": "CUSTO_DIRETO_OUTRO",
  fretes: "CUSTO_DIRETO_OUTRO",
  "seguro sobre transporte de compras": "CUSTO_DIRETO_OUTRO",
  "custos com socorro": "CUSTO_DIRETO_OUTRO",
  "garantias e retrabalho": "CUSTO_DIRETO_OUTRO",
  "garantias e retrabalhos": "CUSTO_DIRETO_OUTRO",
  "perdas e avarias de estoque": "CUSTO_DIRETO_OUTRO",
  "perdas, avarias e ajustes de estoque": "CUSTO_DIRETO_OUTRO",
  "tarifa sobre importacao": "TRIBUTO_COMPRA_RESULTADO",

  // --------------------------------------------------------- despesa pessoal
  salarios: "DESPESA_PESSOAL",
  "pro-labore": "DESPESA_PESSOAL",
  "adiantamentos salariais": "DESPESA_PESSOAL",
  "horas extras": "DESPESA_PESSOAL",
  comissoes: "DESPESA_PESSOAL",
  "comissoes de funcionarios": "DESPESA_PESSOAL",
  ferias: "DESPESA_PESSOAL",
  "decimo terceiro salario": "DESPESA_PESSOAL",
  fgts: "DESPESA_PESSOAL",
  "inss sobre folha": "DESPESA_PESSOAL",
  "encargos trabalhistas": "DESPESA_PESSOAL",
  beneficios: "DESPESA_PESSOAL",
  "vale-transporte": "DESPESA_PESSOAL",
  "vale-alimentacao e refeicao": "DESPESA_PESSOAL",
  "plano de saude": "DESPESA_PESSOAL",
  farmacia: "DESPESA_PESSOAL",
  exames: "DESPESA_PESSOAL",
  "uniformes e epis": "DESPESA_PESSOAL",
  "uniformes e equipamentos de protecao": "DESPESA_PESSOAL",
  treinamentos: "DESPESA_PESSOAL",
  "treinamentos e cursos": "DESPESA_PESSOAL",
  rescisoes: "DESPESA_PESSOAL",
  "rescisoes trabalhistas": "DESPESA_PESSOAL",
  "profissionais autonomos": "DESPESA_PESSOAL",
  "servicos de profissionais autonomos": "DESPESA_PESSOAL",

  // -------------------------------------------------- despesa administrativa
  contabilidade: "DESPESA_ADMINISTRATIVA",
  "consultoria juridica": "DESPESA_ADMINISTRATIVA",
  "servicos juridicos": "DESPESA_ADMINISTRATIVA",
  "consultorias administrativas": "DESPESA_ADMINISTRATIVA",
  "cartorio e autenticacoes": "DESPESA_ADMINISTRATIVA",
  "material de escritorio": "DESPESA_ADMINISTRATIVA",
  "materiais de escritorio": "DESPESA_ADMINISTRATIVA",
  "copa e cozinha": "DESPESA_ADMINISTRATIVA",
  seguros: "DESPESA_ADMINISTRATIVA",
  "seguros empresariais": "DESPESA_ADMINISTRATIVA",
  "despesas administrativas diversas": "DESPESA_ADMINISTRATIVA",
  "correios e entregas administrativas": "DESPESA_ADMINISTRATIVA",
  "licencas, alvaras e autorizacoes": "DESPESA_ADMINISTRATIVA",
  "taxas municipais e alvaras": "DESPESA_ADMINISTRATIVA",
  "taxas municipais": "DESPESA_ADMINISTRATIVA",
  "taxas estaduais": "DESPESA_ADMINISTRATIVA",
  "taxas federais": "DESPESA_ADMINISTRATIVA",
  "licenciamento e orgaos reguladores": "DESPESA_ADMINISTRATIVA",
  iptu: "DESPESA_ADMINISTRATIVA",
  ipva: "DESPESA_ADMINISTRATIVA",

  // ------------------------------------------------------------- tecnologia
  "sistemas e softwares": "DESPESA_TECNOLOGIA",
  "softwares e sistemas": "DESPESA_TECNOLOGIA",
  "hospedagem e servidores": "DESPESA_TECNOLOGIA",
  "certificado digital": "DESPESA_TECNOLOGIA",
  "assinaturas e mensalidades": "DESPESA_TECNOLOGIA",
  internet: "DESPESA_TECNOLOGIA",
  telefone: "DESPESA_TECNOLOGIA",

  // ------------------------------------------------------ ocupação e estrutura
  aluguel: "DESPESA_OCUPACAO",
  condominio: "DESPESA_OCUPACAO",
  "energia eletrica": "DESPESA_OCUPACAO",
  "agua e esgoto": "DESPESA_OCUPACAO",
  "manutencao predial": "DESPESA_OCUPACAO",
  "limpeza e conservacao": "DESPESA_OCUPACAO",
  "material de limpeza": "DESPESA_OCUPACAO",
  "materiais de limpeza": "DESPESA_OCUPACAO",
  "seguranca e monitoramento": "DESPESA_OCUPACAO",
  "ferramentas de pequeno valor": "DESPESA_OCUPACAO",
  "manutencao de ferramentas": "DESPESA_OCUPACAO",
  "maquinas e equipamentos de pequeno valor": "DESPESA_OCUPACAO",
  "manutencao de maquinas e equipamentos": "DESPESA_OCUPACAO",
  "manutencao de maquinas, equipamentos e ferramentas": "DESPESA_OCUPACAO",
  "epis de uso operacional": "DESPESA_OCUPACAO",
  "material de consumo da oficina": "DESPESA_OCUPACAO",
  "estopas, panos e produtos de limpeza": "DESPESA_OCUPACAO",
  "gases, solda e materiais de corte": "DESPESA_OCUPACAO",
  "descarte de residuos": "DESPESA_OCUPACAO",
  "controle ambiental": "DESPESA_OCUPACAO",
  "calibracao de equipamentos": "DESPESA_OCUPACAO",
  "pequenas reformas e melhorias": "DESPESA_OCUPACAO",

  // ------------------------------------------------------- despesa comercial
  "publicidade e propaganda": "DESPESA_COMERCIAL",
  "marketing e publicidade": "DESPESA_COMERCIAL",
  "trafego pago": "DESPESA_COMERCIAL",
  "gestao de redes sociais": "DESPESA_COMERCIAL",
  "producao de fotos e videos": "DESPESA_COMERCIAL",
  "material grafico": "DESPESA_COMERCIAL",
  "brindes e promocoes": "DESPESA_COMERCIAL",
  "plataformas de venda": "DESPESA_COMERCIAL",
  "taxas do mercado livre": "DESPESA_COMERCIAL",
  "taxas de marketplaces": "DESPESA_COMERCIAL",
  "frete de vendas": "DESPESA_COMERCIAL",
  embalagens: "DESPESA_COMERCIAL",
  "viagens comerciais": "DESPESA_COMERCIAL",
  "representacao comercial": "DESPESA_COMERCIAL",
  "atendimento e pos-venda": "DESPESA_COMERCIAL",
  "comissoes de vendedores": "DESPESA_COMERCIAL",
  "correios, entregas e transportes": "DESPESA_COMERCIAL",
  "feira e eventos": "DESPESA_COMERCIAL",

  // --------------------------------------------- outras despesas operacionais
  combustivel: "DESPESA_OPERACIONAL_OUTRA",
  "combustiveis e deslocamentos": "DESPESA_OPERACIONAL_OUTRA",
  "manutencao de veiculos da empresa": "DESPESA_OPERACIONAL_OUTRA",
  "manut. veiculos": "DESPESA_OPERACIONAL_OUTRA",
  "pneus de veiculos da empresa": "DESPESA_OPERACIONAL_OUTRA",
  "seguro de veiculos": "DESPESA_OPERACIONAL_OUTRA",
  "ipva e licenciamento": "DESPESA_OPERACIONAL_OUTRA",
  pedagios: "DESPESA_OPERACIONAL_OUTRA",
  estacionamento: "DESPESA_OPERACIONAL_OUTRA",
  "multas de transito": "DESPESA_OPERACIONAL_OUTRA",
  "locacao de veiculos": "DESPESA_OPERACIONAL_OUTRA",
  "fretes e transportadoras": "DESPESA_OPERACIONAL_OUTRA",
  "guincho e remocao": "DESPESA_OPERACIONAL_OUTRA",
  "despesas diversas da oficina": "DESPESA_OPERACIONAL_OUTRA",

  // -------------------------------------------------- resultado financeiro
  "tarifas bancarias": "DESPESA_FINANCEIRA",
  "taxas de pix": "DESPESA_FINANCEIRA",
  "taxas de pix e meios de pagamento": "DESPESA_FINANCEIRA",
  "taxas de boleto": "DESPESA_FINANCEIRA",
  "taxas de cartao": "DESPESA_FINANCEIRA",
  "antecipacao de recebiveis": "DESPESA_FINANCEIRA",
  "juros de emprestimos": "DESPESA_FINANCEIRA",
  "juros de financiamentos": "DESPESA_FINANCEIRA",
  "juros pagos": "DESPESA_FINANCEIRA",
  "juros pagos a fornecedores": "DESPESA_FINANCEIRA",
  "multas por atraso": "DESPESA_FINANCEIRA",
  "multas financeiras": "DESPESA_FINANCEIRA",
  iof: "DESPESA_FINANCEIRA",
  "descontos financeiros concedidos": "DESPESA_FINANCEIRA",
  "variacao cambial negativa": "DESPESA_FINANCEIRA",
  "outras despesas financeiras": "DESPESA_FINANCEIRA",
  "rendimentos de aplicacoes": "RECEITA_FINANCEIRA",
  "rendimentos financeiros": "RECEITA_FINANCEIRA",
  "juros recebidos": "RECEITA_FINANCEIRA",
  "juros recebidos de clientes": "RECEITA_FINANCEIRA",
  "multas recebidas de clientes": "RECEITA_FINANCEIRA",
  "descontos obtidos": "RECEITA_FINANCEIRA",
  "descontos financeiros obtidos": "RECEITA_FINANCEIRA",
  "cashback recebido": "RECEITA_FINANCEIRA",
  "variacao cambial positiva": "RECEITA_FINANCEIRA",
  "outras receitas financeiras": "RECEITA_FINANCEIRA",

  // ------------------------------------------------------------ patrimonial
  "compra de imoveis": "PATRIMONIAL_IMOBILIZADO",
  "construcao de galpao": "PATRIMONIAL_IMOBILIZADO",
  "reforma estrutural": "PATRIMONIAL_IMOBILIZADO",
  "obras e melhorias": "PATRIMONIAL_IMOBILIZADO",
  "compra de veiculos para uso": "PATRIMONIAL_IMOBILIZADO",
  "veiculos da empresa": "PATRIMONIAL_IMOBILIZADO",
  "compra de elevadores automotivos": "PATRIMONIAL_IMOBILIZADO",
  "compra de maquinas": "PATRIMONIAL_IMOBILIZADO",
  "compra de ferramentas": "PATRIMONIAL_IMOBILIZADO",
  "ferramentas de alto valor": "PATRIMONIAL_IMOBILIZADO",
  "equipamentos de diagnostico": "PATRIMONIAL_IMOBILIZADO",
  "compra de computadores": "PATRIMONIAL_IMOBILIZADO",
  "computadores e equipamentos": "PATRIMONIAL_IMOBILIZADO",
  "compra de moveis e utensilios": "PATRIMONIAL_IMOBILIZADO",
  "moveis e instalacoes": "PATRIMONIAL_IMOBILIZADO",
  "desenvolvimento de software proprio": "PATRIMONIAL_IMOBILIZADO",

  "aporte de capital": "PATRIMONIAL_SOCIOS",
  "aporte de socios": "PATRIMONIAL_SOCIOS",
  "integralizacao de capital social": "PATRIMONIAL_SOCIOS",
  "distribuicao de lucros": "PATRIMONIAL_SOCIOS",
  "retirada de socios": "PATRIMONIAL_SOCIOS",
  "devolucao de capital": "PATRIMONIAL_SOCIOS",
  "adiantamento para socios": "PATRIMONIAL_SOCIOS",

  "emprestimo recebido": "PATRIMONIAL_EMPRESTIMO",
  "emprestimos recebidos": "PATRIMONIAL_EMPRESTIMO",
  "financiamento recebido": "PATRIMONIAL_EMPRESTIMO",
  "amortizacao de emprestimo": "PATRIMONIAL_EMPRESTIMO",
  "amortizacao de financiamento": "PATRIMONIAL_EMPRESTIMO",
  "pagamento de emprestimos": "PATRIMONIAL_EMPRESTIMO",
  "emprestimo de socio para a empresa": "PATRIMONIAL_EMPRESTIMO",
  "devolucao de emprestimo ao socio": "PATRIMONIAL_EMPRESTIMO",

  "transferencia entre contas": "TRANSFERENCIA_INTERNA",
  "transferencia do caixa para banco": "TRANSFERENCIA_INTERNA",
  "transferencia do banco para caixa": "TRANSFERENCIA_INTERNA",
  "aplicacao financeira": "TRANSFERENCIA_INTERNA",
  "resgate de aplicacao financeira": "TRANSFERENCIA_INTERNA",

  "adiantamento de clientes": "ADIANTAMENTO",
  "adiantamento a fornecedores": "ADIANTAMENTO",
};

/**
 * Cadastros que exigem decisão humana. Cada entrada diz por quê — a fila de
 * pendências precisa da pergunta, não só do aviso.
 */
const AMBIGUAS: Record<string, { certeza: Certeza; motivo: string }> = {
  "despesas nao identificadas": {
    certeza: "NENHUMA",
    motivo:
      "A conta declara que a natureza é desconhecida. Classificar como despesa inventaria um fato; mantê-la excluída trata a falta de informação como decisão.",
  },
  "estornos e ajustes financeiros": {
    certeza: "NENHUMA",
    motivo: "Estorno acompanha a classificação do fato original, que varia lançamento a lançamento.",
  },
  "estorno de entrada": {
    certeza: "NENHUMA",
    motivo: "Estorno acompanha o fato original; não tem classificação própria.",
  },
  "estorno de saida": {
    certeza: "NENHUMA",
    motivo: "Estorno acompanha o fato original; não tem classificação própria.",
  },
  "estorno de antecipacao": {
    certeza: "NENHUMA",
    motivo:
      "Reverte uma taxa de antecipação já lançada. Depende do lançamento revertido, não de uma linha fixa.",
  },
  "estornos de recebimentos": {
    certeza: "NENHUMA",
    motivo: "Pode ser cancelamento, devolução ou correção de baixa. Cada caso tem destino diferente.",
  },
  "ajuste de saldo positivo": {
    certeza: "NENHUMA",
    motivo: "Ajuste de conciliação não é fato econômico: ou tem contrapartida identificada, ou é erro a corrigir.",
  },
  "ajuste de saldo negativo": {
    certeza: "NENHUMA",
    motivo: "Ajuste de conciliação não é fato econômico: ou tem contrapartida identificada, ou é erro a corrigir.",
  },
  "conciliacao bancaria": {
    certeza: "NENHUMA",
    motivo: "Ajuste de conciliação não é fato econômico.",
  },
  devolucao: {
    certeza: "BAIXA",
    motivo:
      "Não diz se é devolução de venda (dedução da receita) ou de compra (redução do custo). Está cadastrada nos dois grupos entre os clientes.",
  },
  "venda de ativo imobilizado": {
    certeza: "BAIXA",
    motivo:
      "O preço recebido não é o ganho. Sem o valor contábil e a baixa do bem, a apuração fica incompleta (CPC 27, 67–71).",
  },
  "venda de bens do imobilizado": {
    certeza: "BAIXA",
    motivo: "O preço recebido não é o ganho: depende do valor contábil baixado.",
  },
  "depreciacao de imobilizado": {
    certeza: "BAIXA",
    motivo:
      "Hoje está em grupo excluído do resultado. Depreciação é despesa (linha 8), mas mudar isso altera resultados já publicados.",
  },
  "depreciacao de bens": {
    certeza: "BAIXA",
    motivo: "Hoje está em grupo excluído do resultado; passar para a linha 8 altera resultados já publicados.",
  },
  "transferencia entre empresas do mesmo grupo": {
    certeza: "BAIXA",
    motivo:
      "Entre pessoas jurídicas distintas não é transferência interna: pode ser empréstimo, aporte ou rateio de despesa.",
  },
  consorcios: {
    certeza: "BAIXA",
    motivo: "A parcela mistura poupança para aquisição, taxa de administração e seguro, com destinos diferentes.",
  },
  "reembolso de despesas de socios": {
    certeza: "BAIXA",
    motivo: "Pode ser despesa da empresa paga pelo sócio ou retirada disfarçada.",
  },
  "reembolsos recebidos": {
    certeza: "BAIXA",
    motivo: "Depende do que foi reembolsado: recuperação de despesa, de custo ou receita.",
  },
  "receitas nao operacionais": {
    certeza: "BAIXA",
    motivo: "Rótulo genérico; não identifica se é resultado financeiro, ganho ou receita da atividade.",
  },
  "outras receitas": {
    certeza: "BAIXA",
    motivo: "Rótulo genérico; hoje cai em receita financeira apenas pelo grupo em que foi cadastrada.",
  },
  "comissoes recebidas": {
    certeza: "BAIXA",
    motivo: "Pode ser receita da atividade (intermediação) ou recuperação de despesa.",
  },
  "comissoes sobre vendas": {
    certeza: "BAIXA",
    motivo:
      "Hoje deduz a receita. Comissão paga a vendedor é despesa comercial; mudar altera receita líquida e margens.",
  },
  "taxas de cartao sobre vendas": {
    certeza: "BAIXA",
    motivo:
      "Hoje deduz a receita. Taxa de meio de pagamento é despesa financeira; mudar altera receita líquida.",
  },
  inss: {
    certeza: "BAIXA",
    motivo: "Sem indicar se é contribuição patronal sobre a folha ou retenção; os destinos são diferentes.",
  },
  "icms-st": {
    certeza: "BAIXA",
    motivo:
      "Pode ser substituição na venda (dedução) ou tributo da entrada levado ao resultado pela política atual.",
  },
  "multas e juros tributarios": {
    certeza: "BAIXA",
    motivo: "Encargo de mora não é tributo sobre receita; falta decidir entre despesa financeira e administrativa.",
  },
  "multas fiscais": {
    certeza: "BAIXA",
    motivo: "Penalidade não é tributo sobre receita; falta decidir a despesa correspondente.",
  },
  "juros sobre tributos": {
    certeza: "BAIXA",
    motivo: "Encargo de mora, não tributo sobre receita.",
  },
  "parcelamentos tributarios": {
    certeza: "BAIXA",
    motivo: "A parcela mistura principal do tributo e encargos; separá-los depende do demonstrativo do parcelamento.",
  },
  "outros impostos e taxas": {
    certeza: "BAIXA",
    motivo: "Rótulo genérico: pode ser tributo sobre receita, taxa administrativa ou tributo sobre lucro.",
  },
};

/**
 * Regra por grupo. Vale como herança quando a conta não tem nome reconhecido, e
 * é sempre MEDIA: acertar o grupo não prova que a conta pertence a ele.
 */
const POR_GRUPO: Record<string, string> = {
  receitas: "RECEITA_SERVICOS",
  "deducoes de receita": "TRIBUTO_RECEITA",
  "custos diretos": "CUSTO_SERVICO",
  pessoal: "DESPESA_PESSOAL",
  "despesas administrativas": "DESPESA_ADMINISTRATIVA",
  "despesas comerciais": "DESPESA_COMERCIAL",
  "despesas operacionais": "DESPESA_OPERACIONAL_OUTRA",
  "veiculos e logistica": "DESPESA_OPERACIONAL_OUTRA",
  "oficina e estrutura": "DESPESA_OCUPACAO",
  "despesas financeiras": "DESPESA_FINANCEIRA",
  "receitas financeiras": "RECEITA_FINANCEIRA",
  "receitas financeiras e outras receitas": "RECEITA_FINANCEIRA",
  "investimentos e imobilizado": "PATRIMONIAL_IMOBILIZADO",
  "emprestimos e financiamentos": "PATRIMONIAL_EMPRESTIMO",
  "socios e patrimonio": "PATRIMONIAL_SOCIOS",
};

const CODIGOS = new Set(CLASSIFICACOES.map((c) => c.codigo));

function valida(codigo: string) {
  if (!CODIGOS.has(codigo)) throw new Error(`Sugestão aponta para classificação inexistente: ${codigo}.`);
  return codigo;
}

/**
 * Grupos que hoje misturam finalidades. A conta manda; a herança do grupo não
 * pode ser aceita como boa. "Impostos e taxas" é o caso concreto que colocou
 * IRPJ e CSLL em dedução da receita.
 */
const GRUPOS_MISTOS = new Set([
  "impostos e taxas",
  "tributos e taxas",
  "movimentacoes nao operacionais",
  "transferencias e ajustes",
]);

export function grupoEhMisto(grupoNome: string) {
  return GRUPOS_MISTOS.has(normalizar(grupoNome));
}

export function sugerirClassificacaoGrupo(grupoNome: string): Sugestao {
  const nome = normalizar(grupoNome);

  if (GRUPOS_MISTOS.has(nome)) {
    return {
      classificacao: null,
      certeza: "NENHUMA",
      justificativa:
        "Grupo com finalidades misturadas: as contas precisam de regra própria antes de o grupo receber um padrão.",
      exigeRevisao: true,
    };
  }

  const codigo = POR_GRUPO[nome];
  if (codigo) {
    return {
      classificacao: valida(codigo),
      certeza: "MEDIA",
      justificativa: `Nome do grupo corresponde a "${codigo}". Confirmar que todas as contas dele têm essa finalidade.`,
      exigeRevisao: true,
    };
  }

  return {
    classificacao: null,
    certeza: "NENHUMA",
    justificativa: "Nome do grupo não corresponde a nenhuma classificação do catálogo.",
    exigeRevisao: true,
  };
}

export function sugerirClassificacaoConta(entrada: {
  contaNome: string;
  grupoNome: string;
}): Sugestao {
  const conta = normalizar(entrada.contaNome);
  const grupo = normalizar(entrada.grupoNome);

  const ambigua = AMBIGUAS[conta];
  if (ambigua) {
    return {
      classificacao: null,
      certeza: ambigua.certeza,
      justificativa: ambigua.motivo,
      exigeRevisao: true,
    };
  }

  const porNomeEGrupo = POR_NOME_E_GRUPO[`${conta}@@${grupo}`];
  if (porNomeEGrupo) {
    return {
      classificacao: valida(porNomeEGrupo),
      certeza: "ALTA",
      justificativa: `Nome da conta identifica a finalidade dentro do grupo "${entrada.grupoNome}".`,
      exigeRevisao: false,
    };
  }

  const porNome = POR_NOME[conta];
  if (porNome) {
    return {
      classificacao: valida(porNome),
      certeza: "ALTA",
      justificativa: "Nome da conta identifica a finalidade de forma inequívoca no vocabulário conhecido.",
      exigeRevisao: false,
    };
  }

  if (GRUPOS_MISTOS.has(grupo)) {
    return {
      classificacao: null,
      certeza: "NENHUMA",
      justificativa: `Conta desconhecida em grupo misto ("${entrada.grupoNome}"): herdar o grupo repetiria o erro de classificação atual.`,
      exigeRevisao: true,
    };
  }

  const porGrupo = POR_GRUPO[grupo];
  if (porGrupo) {
    return {
      classificacao: valida(porGrupo),
      certeza: "MEDIA",
      justificativa: `Conta não reconhecida pelo nome; herda o grupo "${entrada.grupoNome}".`,
      exigeRevisao: true,
    };
  }

  return {
    classificacao: null,
    certeza: "NENHUMA",
    justificativa: "Nem o nome da conta nem o do grupo correspondem ao catálogo.",
    exigeRevisao: true,
  };
}
