/**
 * Pendências da geração em linguagem de quem opera o ERP.
 *
 * Os diagnósticos do motor são técnicos e granulares (um por item de nota).
 * Aqui eles viram pendências agrupadas por categoria, com o motivo do bloqueio,
 * a ação de correção e a tela onde ela acontece. Nada é descartado: cada
 * pendência guarda quantas ocorrências representa e alguns exemplos.
 */

export const SPED_PENDENCY_CATEGORIES = [
  { id: "CADASTRO", label: "Cadastro" },
  { id: "DOCUMENTOS_FISCAIS", label: "Documentos fiscais" },
  { id: "TRIBUTACAO", label: "Tributação" },
  { id: "APURACAO", label: "Apuração" },
  { id: "CONFIGURACAO_CONTABIL", label: "Configuração contábil" },
] as const;
export type SpedPendencyCategory = (typeof SPED_PENDENCY_CATEGORIES)[number]["id"];

export type SpedPendencySourceDiagnostic = {
  codigo: string;
  severidade: string;
  mensagem: string;
  registro?: string | null;
  campo?: string | null;
  fontes?: unknown[];
};

export type SpedPendencyLink = { href: string; label: string };

export type SpedPendency = {
  id: string;
  category: SpedPendencyCategory;
  title: string;
  description: string;
  reason: string;
  action: string;
  record: string | null;
  affected: string[];
  occurrences: number;
  blocking: boolean;
  link: SpedPendencyLink | null;
  codes: string[];
};

export type SpedPendencyGroup = {
  category: SpedPendencyCategory;
  label: string;
  items: SpedPendency[];
};

type Rule = {
  category: SpedPendencyCategory;
  title: string;
  reason: string;
  action: string;
  link?: (competenceId: string | null) => SpedPendencyLink;
  /** Agrupa ocorrências do mesmo código numa pendência só. */
  collapse?: boolean;
};

const advanced = (tab: string, label: string) => (competenceId: string | null): SpedPendencyLink => ({
  href: `/fiscal/sped/avancado${competenceId ? `?competencia=${encodeURIComponent(competenceId)}&aba=${tab}` : ""}`,
  label,
});
const configuration = advanced("configuracao", "Responder perguntas da empresa");
const items = advanced("decisoes-itens", "Informar uso dos produtos");
const assessment = advanced("apuracao", "Abrir apuração");
const imports = advanced("importacoes", "Abrir importações");
const entries = (): SpedPendencyLink => ({ href: "/fiscal/sped/avancado", label: "Confirmar datas de entrada" });
const products = (): SpedPendencyLink => ({ href: "/estoque", label: "Abrir cadastro de produtos" });
const company = (): SpedPendencyLink => ({ href: "/configuracoes/empresa", label: "Abrir dados da empresa" });
const notes = (): SpedPendencyLink => ({ href: "/fiscal", label: "Abrir notas fiscais" });
const bankAccounts = (): SpedPendencyLink => ({ href: "/configuracoes/tipos?aba=bancos", label: "Abrir contas bancárias" });
const cashFlow = (): SpedPendencyLink => ({ href: "/fluxodecaixa", label: "Abrir fluxo de caixa" });

const RULES: Record<string, Rule> = {
  EMPRESA_AUSENTE: { category: "CADASTRO", title: "Empresa não cadastrada", reason: "O registro 0000 identifica o contribuinte.", action: "Cadastre os dados da empresa.", link: company },
  CONTABILISTA_AUSENTE: { category: "CONFIGURACAO_CONTABIL", title: "Contador responsável não informado", reason: "O registro 0100 é obrigatório e identifica o contabilista da escrituração. A prévia sai com um contador de marcação (\"CONTADOR NAO CADASTRADO - PREVIA\") só para conferência; o arquivo final exige o contador real.", action: "Peça ao contador nome, CPF, CRC, endereço e e-mail e cadastre na configuração (uma única vez).", link: configuration },
  CONFIGURACAO_SPED_AUSENTE: { category: "CONFIGURACAO_CONTABIL", title: "Configuração fiscal inicial não feita", reason: "Perfil, atividade e obrigações condicionais definem o conteúdo do arquivo.", action: "Responda às perguntas sobre a empresa (uma única vez).", link: configuration },
  GATE_TIMEZONE_STATUS_NAO_CONFIRMADO: { category: "CONFIGURACAO_CONTABIL", title: "Fuso horário do estabelecimento", reason: "Datas sem fuso no ERP precisam do fuso local para cair no mês certo.", action: "Informe o fuso da cidade da empresa nas perguntas da configuração.", link: configuration },
  GATE_PERFIL_EFD_STATUS_NAO_CONFIRMADO: { category: "CONFIGURACAO_CONTABIL", title: "Perfil de apresentação da EFD", reason: "O perfil (A, B ou C) é definido pelo Fisco estadual e muda os registros exigidos.", action: "Pergunte ao contador o perfil do SPED e responda na configuração.", link: configuration },
  PERFIL_EFD_PENDENTE: { category: "CONFIGURACAO_CONTABIL", title: "Perfil de apresentação da EFD", reason: "O perfil (A, B ou C) é definido pelo Fisco estadual e muda os registros exigidos.", action: "Pergunte ao contador o perfil do SPED e responda na configuração.", link: configuration },
  GATE_INDICADOR_ATIVIDADE_STATUS_NAO_CONFIRMADO: { category: "CONFIGURACAO_CONTABIL", title: "Indicador de atividade", reason: "O 0000 informa se a atividade é industrial ou outras.", action: "Responda se a empresa fabrica ou importa produtos.", link: configuration },
  GATE_CONTRIBUINTE_IPI_STATUS_PENDENTE: { category: "CONFIGURACAO_CONTABIL", title: "Condição de contribuinte do IPI", reason: "Define os campos de IPI e a apuração do Bloco E.", action: "Responda se a empresa fabrica ou importa produtos.", link: configuration },
  GATE_ENTREGA_EFD_CONTRIBUICOES_STATUS_PENDENTE: { category: "CONFIGURACAO_CONTABIL", title: "Entrega da EFD-Contribuições", reason: "Influencia campos de PIS/COFINS da escrituração.", action: "Confira o regime tributário no cadastro da empresa ou responda na configuração.", link: configuration },
  BLOCO_K_PENDENTE: { category: "CONFIGURACAO_CONTABIL", title: "Obrigatoriedade do Bloco K", reason: "O Bloco K depende de atividade, CNAE e faturamento; o sistema não presume dispensa.", action: "Confira o regime tributário e o CNAE no cadastro da empresa ou responda na configuração.", link: configuration },
  BLOCO_K_REGISTROS_AUSENTES: { category: "APURACAO", title: "Bloco K exigido sem registros", reason: "O Bloco K foi confirmado como obrigatório, e o ERP não gera movimentos de produção e estoque.", action: "Revise a obrigatoriedade com o contador; se exigido, a geração depende do controle de produção.", link: configuration },
  INVENTARIO_PENDENTE: { category: "CONFIGURACAO_CONTABIL", title: "Inventário (Bloco H) nesta competência", reason: "O inventário é exigido em competências específicas (ex.: fevereiro, encerramento de atividade).", action: "Confirme na configuração a regra do inventário (fevereiro, com o estoque de 31/12).", link: configuration },
  INVENTARIO_REGISTROS_AUSENTES: { category: "APURACAO", title: "Inventário aprovado ausente", reason: "O inventário é exigido e nenhum fechamento aprovado foi vinculado.", action: "Registre e aprove o inventário de estoque de 31/12; o ERP ainda não tem tela para isso, fale com o suporte.", link: configuration },
  REGISTRO_1400_PENDENTE: { category: "CONFIGURACAO_CONTABIL", title: "Registro 1400 (valor adicionado)", reason: "Algumas UFs exigem o 1400 para o índice de participação dos municípios.", action: "Pergunte ao contador e responda na configuração.", link: configuration },
  REGISTRO_1601_PENDENTE: { category: "CONFIGURACAO_CONTABIL", title: "Registro 1601 (pagamentos eletrônicos)", reason: "Operações com cartão/PIX intermediadas podem exigir o 1601.", action: "Responda se a empresa recebe por cartão ou PIX.", link: configuration },
  CONTA_SEM_CNPJ_INSTITUICAO: { category: "CADASTRO", title: "Conta bancária sem CNPJ da instituição", reason: "O registro 1601 informa as vendas recebidas por PIX, cartão, boleto e transferência separadas por banco, e o banco é o da conta em que o recebimento foi lançado.", action: "Informe o CNPJ do banco no cadastro da conta (há um atalho com os bancos mais comuns).", link: bankAccounts, collapse: true },
  RECEBIMENTO_ELETRONICO_SEM_CONTA: { category: "DOCUMENTOS_FISCAIS", title: "Recebimentos eletrônicos sem conta bancária", reason: "Sem a conta não há como saber em que banco a venda foi recebida, e o 1601 é separado por banco.", action: "Informe a conta nos recebimentos indicados (cartão, boleto, PIX).", link: cashFlow, collapse: true },
  REGISTROS_C176_C179_PENDENTES: { category: "CONFIGURACAO_CONTABIL", title: "Ressarcimento de ICMS-ST (C176/C179)", reason: "Define se a empresa pede ressarcimento de ICMS-ST nas saídas.", action: "Responda na configuração se a empresa pede ressarcimento de ICMS-ST.", link: configuration },
  C176_C179_APLICABILIDADE_DETECTADA: { category: "TRIBUTACAO", title: "Saída com possível ressarcimento de ICMS-ST", reason: "Há saída interestadual ou devolução de mercadoria com ICMS-ST retido anteriormente.", action: "Decida com o contador se haverá pedido de ressarcimento.", link: configuration },
  REGISTRO_CONDICIONAL_AUSENTE: { category: "TRIBUTACAO", title: "C176/C179 exigido e não gerado", reason: "O ressarcimento foi confirmado como aplicável, e o ERP não gera esses registros.", action: "Revise a aplicabilidade; o ressarcimento exige apuração específica.", link: configuration, collapse: true },
  INDICADORES_1010_PENDENTES: { category: "CONFIGURACAO_CONTABIL", title: "Indicadores do registro 1010", reason: "O 1010 declara quais registros do Bloco 1 a empresa precisaria apresentar.", action: "Responda às perguntas sobre a atividade da empresa.", link: configuration },
  EFD_ANTERIOR_AUSENTE: { category: "APURACAO", title: "EFD do mês anterior não importada", reason: "Os saldos credores que passam de um mês para o outro vêm da EFD do mês anterior entregue à Receita. Quando o mês anterior foi fechado no ERP, ele usa os próprios saldos; esta pendência só aparece no primeiro mês.", action: "Importe o TXT da EFD do mês anterior que foi entregue, de qualquer sistema (peça ao contador).", link: imports },
  E116_RECOLHIMENTO_AUSENTE: { category: "APURACAO", title: "Guia do ICMS a recolher não informada", reason: "O E116 registra a obrigação a recolher apurada no mês.", action: "Informe código de receita e vencimento do ICMS próprio.", link: assessment },
  E116_VALOR_DIVERGENTE: { category: "APURACAO", title: "Guia do ICMS diverge da apuração", reason: "O total do E116 precisa ser igual ao ICMS a recolher.", action: "Revise o valor da obrigação a recolher.", link: assessment },
  E316_RECOLHIMENTO_AUSENTE: { category: "APURACAO", title: "Guia de DIFAL/FCP não informada", reason: "O E316 registra o DIFAL/FCP a recolher por UF de destino.", action: "Informe os recolhimentos de DIFAL/FCP de cada UF.", link: assessment, collapse: true },
  E316_VALOR_DIVERGENTE: { category: "APURACAO", title: "Guia de DIFAL/FCP diverge da apuração", reason: "O total do E316 precisa ser igual ao valor calculado na UF.", action: "Revise os valores informados.", link: assessment, collapse: true },
  E110_DEBITOS_DIVERGENTES: { category: "APURACAO", title: "Débitos da apuração não fecham com as notas", reason: "O E110 precisa somar o ICMS das saídas.", action: "Reporte ao suporte: é uma inconsistência interna do motor.", link: assessment },
  E110_CREDITOS_DIVERGENTES: { category: "APURACAO", title: "Créditos da apuração não fecham com as notas", reason: "O E110 precisa somar o ICMS creditado nas entradas.", action: "Reporte ao suporte: é uma inconsistência interna do motor.", link: assessment },
  DATA_ENTRADA_FISCAL_NAO_CONFIRMADA: { category: "DOCUMENTOS_FISCAIS", title: "Entradas sem data de entrada confirmada", reason: "A entrada é escriturada no mês em que a mercadoria chegou, não pela emissão.", action: "Confirme a data de entrada de cada nota.", link: entries, collapse: true },
  NFE_RECEBIDA_SEM_ENTRADA: { category: "DOCUMENTOS_FISCAIS", title: "NF-e de compra sem entrada registrada", reason: "A SEFAZ tem NF-e emitida contra o CNPJ da empresa que não foi lançada no ERP.", action: "Se a mercadoria chegou, registre a entrada. Se a empresa não reconhece a compra, manifeste \"Operação desconhecida\" ou \"Operação não realizada\" na nota recebida; o aviso some.", link: notes, collapse: true },
  ENTRADA_EMITIDA_NA_COMPETENCIA_SEM_DATA: { category: "DOCUMENTOS_FISCAIS", title: "Compra do mês registrada depois e sem data de entrada", reason: "A nota foi emitida nesta competência e só lançada depois.", action: "Confirme a data de entrada; se a mercadoria chegou neste mês, ela entra nesta competência.", link: entries, collapse: true },
  DFE_ENTRADA_AUSENTE: { category: "DOCUMENTOS_FISCAIS", title: "Entrada sem XML da nota", reason: "O C100/C170 é montado a partir do XML autorizado.", action: "Baixe o XML da nota (DF-e) e vincule à entrada.", link: notes, collapse: true },
  DFE_ESTABELECIMENTO_DIVERGENTE: { category: "DOCUMENTOS_FISCAIS", title: "Nota de outro estabelecimento vinculada", reason: "O documento pertence a outro CNPJ.", action: "Corrija o vínculo da entrada.", link: notes, collapse: true },
  ENTRADA_NFE_CANCELADA: { category: "DOCUMENTOS_FISCAIS", title: "Entrada com nota cancelada pelo fornecedor", reason: "Nota cancelada do fornecedor não é escriturada.", action: "Cancele a entrada ou vincule a nota substituta.", link: notes, collapse: true },
  XML_FISCAL_AUSENTE: { category: "DOCUMENTOS_FISCAIS", title: "Documento sem XML preservado", reason: "Sem o XML autorizado não há como escriturar o documento.", action: "Recupere o XML autorizado do documento.", link: notes, collapse: true },
  XML_FISCAL_INVALIDO: { category: "DOCUMENTOS_FISCAIS", title: "XML que não pôde ser lido", reason: "O documento tem dados que impedem a escrituração (participante, chave ou data).", action: "Confira o documento indicado.", link: notes, collapse: true },
  NFE_SITUACAO_NAO_ESCRITURAVEL: { category: "DOCUMENTOS_FISCAIS", title: "NF-e sem situação definida na SEFAZ", reason: "Notas enviadas sem retorno ou em contingência ainda podem ser autorizadas ou rejeitadas.", action: "Consulte a situação na SEFAZ e atualize a nota.", link: notes, collapse: true },
  DOCUMENTO_FISCAL_DUPLICADO: { category: "DOCUMENTOS_FISCAIS", title: "Documento repetido", reason: "A mesma chave aparece em mais de uma origem.", action: "Remova a duplicidade (ex.: duas entradas da mesma nota).", link: notes, collapse: true },
  RECONCILIACAO_DOCUMENTOS_DIVERGENTE: { category: "DOCUMENTOS_FISCAIS", title: "Documentos sem conferência", reason: "A quantidade de documentos do banco não fecha com a do arquivo.", action: "Gere novamente; persistindo, reporte ao suporte.", link: notes },
  RECONCILIACAO_C100_DIVERGENTE: { category: "DOCUMENTOS_FISCAIS", title: "Documentos sem conferência", reason: "A quantidade de documentos projetados não fecha com a de C100.", action: "Reporte ao suporte.", link: notes },
  APROPRIACAO_ITEM_AMBIGUA: { category: "CADASTRO", title: "Item de entrada ligado a produtos diferentes", reason: "Um item da nota precisa corresponder a um único produto.", action: "Corrija o vínculo dos itens da entrada.", link: products, collapse: true },
  CODIGO_ITEM_CANONICO_AUSENTE: { category: "CADASTRO", title: "Itens de compra sem estoque ou sem código fiscal", reason: "Cada item da nota de compra precisa de um código estável no 0200, que vem do estoque em que ele entrou.", action: "Vincule o item da entrada a um dos três estoques (Produtos, Uso e consumo ou Geral); produto do estoque de venda recebe o código sozinho na geração automática.", link: items, collapse: true },
  TIPO_ITEM_NAO_DERIVAVEL: { category: "CADASTRO", title: "Tipo do item não pôde ser deduzido", reason: "Saída com CFOP de produção própria: o tipo do item (produto acabado, em processo...) não decorre do estoque.", action: "Classifique o produto uma vez; os próximos meses reaproveitam.", link: items, collapse: true },
  PRODUTO_DOCUMENTO_INEXISTENTE: { category: "CADASTRO", title: "Nota ligada a produto excluído", reason: "O produto do item não existe mais no cadastro.", action: "Vincule o item a um produto ativo.", link: products, collapse: true },
  CODIGO_ITEM_COMPARTILHADO: { category: "CADASTRO", title: "Código fiscal repetido entre produtos", reason: "Dois produtos com o mesmo código seriam um único item no SPED.", action: "Defina códigos distintos para os produtos.", link: items, collapse: true },
  CODIGO_ITEM_INDISPONIVEL: { category: "CADASTRO", title: "Código fiscal do produto indisponível", reason: "Os códigos derivados do produto já pertencem a outros itens.", action: "Defina manualmente o código do produto.", link: items, collapse: true },
  CONFIG_ITEM_ENCERRADA: { category: "CADASTRO", title: "Classificação do produto encerrada", reason: "A configuração do item terminou antes desta competência.", action: "Confirme o código e o tipo vigentes.", link: items, collapse: true },
  CONFIG_ITEM_VIGENCIA_SOBREPOSTA: { category: "CADASTRO", title: "Classificações sobrepostas", reason: "O produto tem duas configurações vigentes na mesma data.", action: "Encerre uma das configurações.", link: items, collapse: true },
  CADASTRO_FISCAL_DIVERGENTE: { category: "CADASTRO", title: "Cadastro divergente entre notas", reason: "O mesmo item veio com NCM, CEST, tipo, unidade ou alíquota diferentes entre as notas do mês, ou o participante mudou de inscrição estadual. Endereço, descrição e código de barras diferentes já se resolvem sozinhos.", action: "Corrija o cadastro indicado; ele prevalece sobre as notas.", link: items, collapse: true },
  UNIDADE_CONVERSAO_AUSENTE: { category: "CADASTRO", title: "Fator de conversão de unidade ausente", reason: "O item entrou em unidade diferente da de estoque (0220) e a entrada não diz quanto foi para o estoque.", action: "Cadastre o fator de conversão (ex.: CX → UN).", link: items, collapse: true },
  UNIDADE_CONVERSAO_DIVERGENTE: { category: "CADASTRO", title: "Fator de conversão diferente entre compras", reason: "O mesmo item entrou na mesma unidade da nota com quantidades de estoque que não batem entre si no mês.", action: "Cadastre o fator de conversão do item; ele prevalece sobre o das entradas.", link: items, collapse: true },
  CST_ICMS_EFD_NAO_RESOLVIDO: { category: "TRIBUTACAO", title: "CST de ICMS não definido", reason: "Notas de fornecedores do Simples trazem CSOSN, e a EFD exige CST.", action: "Abra a configuração: o ERP aplica a correspondência usual CSOSN → CST.", link: configuration, collapse: true },
  CFOP_ENTRADA_NAO_RESOLVIDO: { category: "TRIBUTACAO", title: "CFOP de entrada não definido", reason: "A entrada leva o CFOP do destinatário, convertido do CFOP do fornecedor conforme o estoque em que o item entrou.", action: "O CFOP do fornecedor não tem conversão conhecida no ERP para esse estoque: reporte ao suporte com a nota indicada.", link: notes, collapse: true },
  TRATAMENTO_CREDITO_PENDENTE: { category: "TRIBUTACAO", title: "Crédito de ICMS das entradas não definido", reason: "O crédito depende da destinação da mercadoria e do regime.", action: "Defina o tratamento de crédito dos itens indicados.", link: items, collapse: true },
  POLITICA_CREDITO_REVENDA_PENDENTE: { category: "CONFIGURACAO_CONTABIL", title: "Política de crédito nas compras para revenda", reason: "Confirmada uma vez, o ERP aplica o crédito do ICMS destacado nas compras para revenda.", action: "Confira o regime tributário no cadastro da empresa; o ERP decide o crédito a partir dele.", link: configuration },
  C190_REDUCAO_BASE_NAO_RESOLVIDA: { category: "TRIBUTACAO", title: "Redução de base de cálculo não identificada", reason: "O XML usa CST com redução de base sem o percentual.", action: "Confira a nota indicada.", link: notes, collapse: true },
  C190_COMPONENTE_SEM_ALOCACAO: { category: "TRIBUTACAO", title: "Valor da nota sem rateio por item", reason: "Frete, despesas ou ST no total da nota não estão distribuídos nos itens.", action: "Confira a nota indicada.", link: notes, collapse: true },
  DIFAL_UF_DESTINO_AUSENTE: { category: "TRIBUTACAO", title: "DIFAL sem UF de destino", reason: "O DIFAL é apurado por UF de destino.", action: "Confira o endereço do destinatário da nota.", link: notes, collapse: true },
  C176_C179_RESSARCIMENTO_DISPONIVEL: { category: "TRIBUTACAO", title: "Venda que permitiria pedir ressarcimento de ICMS-ST", reason: "A empresa está configurada para não pedir ressarcimento.", action: "Nada a fazer, a menos que o contador queira fazer o pedido.", link: configuration, collapse: true },
  LEIAUTE_NAO_CONFIGURADO: { category: "CONFIGURACAO_CONTABIL", title: "Leiaute oficial não disponível", reason: "O ERP ainda não tem o leiaute oficial vigente nesta competência.", action: "Aguarde a atualização do sistema para o leiaute do exercício." },
};

const FALLBACK: Omit<Rule, "title"> = {
  category: "DOCUMENTOS_FISCAIS",
  reason: "O validador do SPED encontrou uma inconsistência.",
  action: "Revise o item indicado na área avançada.",
  link: advanced("inconsistencias", "Ver detalhes técnicos"),
};

function affectedFrom(diagnostic: SpedPendencySourceDiagnostic): string | null {
  const ref = (diagnostic.fontes ?? [])[0] as { source?: { documentKey?: string; table?: string; id?: unknown } } | undefined;
  const source = ref?.source;
  if (source?.documentKey) return `NF-e ${source.documentKey}`;
  if (source?.table && source.id != null) return `${source.table} ${source.id}`;
  return diagnostic.registro ? `Registro ${diagnostic.registro}` : null;
}

function title(code: string): string {
  return code.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export function buildSpedPendencies(
  diagnostics: readonly SpedPendencySourceDiagnostic[],
  competenceId: string | null,
): { groups: SpedPendencyGroup[]; blocking: number; warnings: SpedPendency[] } {
  const byKey = new Map<string, SpedPendency>();
  for (const diagnostic of diagnostics) {
    const blocking = diagnostic.severidade === "BLOQUEIO" || diagnostic.severidade === "ERRO";
    const rule = RULES[diagnostic.codigo];
    const effective: Rule = rule ?? { ...FALLBACK, title: title(diagnostic.codigo) };
    // Ocorrências repetidas viram uma pendência por código; códigos distintos
    // com o mesmo título (ex.: gate e validador do perfil) viram uma só.
    const key = effective.collapse || !rule ? `codigo:${diagnostic.codigo}|${blocking}` : `titulo:${effective.title}|${blocking}`;
    const affected = affectedFrom(diagnostic);
    const current = byKey.get(key);
    if (current) {
      if (!current.codes.includes(diagnostic.codigo)) current.codes.push(diagnostic.codigo);
      else current.occurrences += 1;
      if (affected && current.affected.length < 5 && !current.affected.includes(affected)) current.affected.push(affected);
      continue;
    }
    byKey.set(key, {
      id: key,
      category: effective.category,
      title: effective.title,
      description: diagnostic.mensagem,
      reason: effective.reason,
      action: effective.action,
      record: diagnostic.registro ?? null,
      affected: affected ? [affected] : [],
      occurrences: 1,
      blocking,
      link: effective.link ? effective.link(competenceId) : null,
      codes: [diagnostic.codigo],
    });
  }
  const pendencies = Array.from(byKey.values());
  const blockingItems = pendencies.filter((item) => item.blocking);
  const groups = SPED_PENDENCY_CATEGORIES
    .map((category) => ({
      category: category.id,
      label: category.label,
      items: blockingItems.filter((item) => item.category === category.id),
    }))
    .filter((group) => group.items.length > 0);
  return {
    groups,
    blocking: blockingItems.reduce((sum, item) => sum + item.occurrences, 0),
    warnings: pendencies.filter((item) => !item.blocking),
  };
}
