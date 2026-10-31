/**
 * Política de emissão da NFS-e: QUAL emissor a nota usa e O QUE ela precisa
 * levar, decidido num lugar só.
 *
 * Antes isto era um `if` no regime e outro no município, e "Nacional" queria
 * dizer "MEI" e também "IBS/CBS obrigatório". As três coisas são independentes:
 *
 * - o modelo de emissão depende do município, da data e do item de serviço;
 * - o regime tributário só decide como o prestador se declara na DPS
 *   (`codigo_opcao_simples_nacional`), e isso fica no mapeador;
 * - a obrigatoriedade dos dados da Reforma Tributária (RTC) depende do regime e
 *   da data, não do modelo.
 *
 * Tudo aqui é puro: a data entra por parâmetro. Quem precisa de "hoje" chama
 * `dataDoDiaNFSe` uma vez e passa o resultado adiante — nenhum componente
 * compara datas por conta própria.
 *
 * Os valores de `codigo_opcao_simples_nacional` e `regime_tributario_simples_
 * nacional` usados pelo mapeador vêm da tabela de campos da Focus para a DPS
 * Nacional (campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html — opSimpNac
 * e regApTribSN do leiaute nacional).
 */

/**
 * Chave do padrão fiscal e do formulário — e o valor de `nfse.modelo_emissao`
 * das notas da Focus. "NACIONAL" aqui é o LAYOUT da DPS nacional, não o
 * autorizador: quem diz para onde a nota vai é `autorizador`.
 */
export type NFSeModeloEmissao = "NACIONAL" | "MUNICIPAL_CABEDELO" | "MUNICIPAL_JOAO_PESSOA";

/** O formato do documento: RPS do emissor municipal antigo ou DPS do padrão nacional. */
export type LayoutNFSe = "MUNICIPAL_LEGADO" | "DPS_NACIONAL";

/**
 * Para onde a nota é enviada. Padrão nacional (layout) NÃO implica Emissor
 * Público Nacional (autorizador): João Pessoa adotou a DPS nacional mantendo
 * emissor próprio. A Focus integra esse ambiente municipal em `/v2/nfsen`.
 *
 * - FOCUS_MUNICIPAL: Focus `/v2/nfse`, emissor municipal antigo;
 * - FOCUS_NACIONAL: Focus `/v2/nfsen`, Emissor Público Nacional (Sefin);
 * - FOCUS_FORMATO_NACIONAL_MUNICIPAL: Focus `/v2/nfsen`, formato nacional em
 *   ambiente municipal próprio. Na Focus, NFSe padrão ativa e Ambiente da
 *   NFSe Nacional desabilitado (guia de João Pessoa após reimplementação).
 */
export type AutorizadorNFSe = "FOCUS_MUNICIPAL" | "FOCUS_NACIONAL" | "FOCUS_FORMATO_NACIONAL_MUNICIPAL";

export type PoliticaNFSe = {
  modelo: NFSeModeloEmissao;
  layout: LayoutNFSe;
  autorizador: AutorizadorNFSe;
  /** O documento é uma DPS no layout nacional (mesmo que o autorizador seja municipal). */
  usaDps: boolean;
  /** CST, cClassTrib, cIndOp e os indicadores da Reforma são exigidos na emissão. */
  exigeRtc: boolean;
  /** Identificador estável da regra que decidiu — vai para log e teste. */
  regra: string;
  /** Explicação curta, para tela e diagnóstico. */
  motivo: string;
  /**
   * Aviso informativo para a tela. Nunca impede a emissão: quem aceita ou
   * recusa é o autorizador, e o retorno dele chega inteiro ao usuário.
   */
  aviso?: string;
};

export type EntradaPoliticaNFSe = {
  codigoMunicipio: unknown;
  regimeTributario: unknown;
  /** Dia da prestação do serviço (dCompet), AAAA-MM-DD; distinto de dhEmi. */
  dataCompetencia: string;
  /**
   * Itens da LC 116 dos serviços da nota. A nota é consolidada, então vale o
   * conjunto: só fica no emissor de exceção se TODOS forem exceção.
   */
  itensListaServico?: Array<string | null | undefined>;
};

const IBGE_JOAO_PESSOA = "2507507";
const IBGE_CABEDELO = "2503209";
const IBGE_LUCENA = "2508604";

/**
 * Simples Nacional (ME/EPP) passa a emitir no padrão Nacional.
 * Resolução CGSN nº 191/2026, que adiou de setembro para novembro o prazo da
 * CGSN nº 189/2026. Aplica-se em TODOS os municípios, inclusive aos que têm
 * autorizador próprio. O comunicado CGNFS-e de 29/10/2026 confirma dCompet
 * como critério e mantém competências anteriores no emissor municipal.
 */
export const INICIO_NACIONAL_SIMPLES = "2026-11-01";

/**
 * Optantes do Simples (inclusive MEI) passam a destacar IBS/CBS no documento.
 * LC 214/2025: em 2026 o regime regular já informa; o Simples começa em 2027.
 */
export const INICIO_RTC_SIMPLES = "2027-01-01";

// ---------------------------------------------------------------------------
// Transição de João Pessoa
//
// Regra temporária e isolada. Quando a prefeitura encerrar de vez o emissor
// municipal, apague este bloco inteiro: `regraJoaoPessoa` passa a devolver
// NACIONAL sempre, e as exceções deixam de existir.
//
// Fonte: o próprio retorno da prefeitura via Focus, a partir de 01/10/2026
// (OS 525 da Demir, 02/10/2026):
//   "O Emissor atual está disponível somente para contribuintes enquadrados no
//    Simples Nacional ou que possuam atividade vigente vinculada aos itens de
//    serviço 01.03, 01.05, 01.09 ou 16.01. Para realizar a emissão, utilize o
//    Novo emissor ajustado ao padrão nacional."
// Em 30/09/2026 a mesma empresa (CRT 3, item 14.01) ainda autorizava pelo
// emissor municipal.
// ---------------------------------------------------------------------------

export const INICIO_NACIONAL_JOAO_PESSOA = "2026-10-01";

/** Itens que a prefeitura ainda aceita no emissor municipal durante a transição. */
export const ITENS_EMISSOR_MUNICIPAL_JOAO_PESSOA = ["01.03", "01.05", "01.09", "16.01"] as const;

/** Trecho que identifica a recusa por emissor encerrado, sem acento e em minúsculas. */
const ASSINATURA_EMISSOR_ENCERRADO = "utilize o novo emissor ajustado ao padrao nacional";

export const MENSAGEM_EMISSOR_NACIONAL_EXIGIDO =
  "João Pessoa exige o novo emissor no padrão Nacional para esta operação. "
  + "O modelo de emissão usado nesta nota está desatualizado: reenviar igual repete a recusa. "
  + "Emita novamente pela tela de emissão, que já usa o padrão Nacional.";

function regraJoaoPessoa(
  regime: string,
  data: string,
  itens: string[],
): PoliticaNFSe {
  const municipal = (regra: string, motivo: string): PoliticaNFSe => ({
    modelo: "MUNICIPAL_JOAO_PESSOA",
    layout: "MUNICIPAL_LEGADO",
    autorizador: "FOCUS_MUNICIPAL",
    usaDps: false,
    exigeRtc: false,
    regra,
    motivo,
  });

  if (data < INICIO_NACIONAL_JOAO_PESSOA) {
    return municipal("JOAO_PESSOA_MUNICIPAL", "Emissor municipal de João Pessoa, antes da migração para o padrão Nacional.");
  }

  const excecoes = new Set<string>(ITENS_EMISSOR_MUNICIPAL_JOAO_PESSOA);
  if (itens.length > 0 && itens.every((item) => excecoes.has(item))) {
    return municipal(
      "JOAO_PESSOA_EXCECAO_ITEM",
      `Item ${[...new Set(itens)].join(", ")} ainda aceito pelo emissor municipal de João Pessoa.`,
    );
  }

  const simples = regime === "1" || regime === "2";
  if (simples && data < INICIO_NACIONAL_SIMPLES) {
    return municipal(
      "JOAO_PESSOA_SIMPLES_TRANSICAO",
      "Optante do Simples Nacional ainda aceito pelo emissor municipal de João Pessoa até 31/10/2026.",
    );
  }

  if (simples) {
    // Simples mantém o cronograma próprio do Emissor Público Nacional.
    return nacional(
      regime,
      data,
      "JOAO_PESSOA_SIMPLES_NACIONAL",
      "Simples Nacional de João Pessoa no Emissor Público Nacional a partir de 01/11/2026 (CGSN 191/2026).",
    );
  }

  // Regime normal: formato nacional via Focus em ambiente municipal (DSF).
  // https://focusnfe.com.br/guides/nfse/municipios-integrados/joao-pessoa-pb/
  return {
    modelo: "NACIONAL",
    layout: "DPS_NACIONAL",
    autorizador: "FOCUS_FORMATO_NACIONAL_MUNICIPAL",
    usaDps: true,
    exigeRtc: rtcObrigatorio(regime, data),
    regra: "JOAO_PESSOA_FORMATO_NACIONAL_2026",
    motivo: "João Pessoa utiliza formato nacional via Focus em ambiente municipal próprio.",
  };
}

/**
 * Reconhece E0039 para diagnóstico da tentativa. Não determina a integração
 * vigente do município nem bloqueia uma nova emissão pela política atual.
 */
export function detectarMunicipioForaDoEmissorNacional(erros: unknown): boolean {
  const lista = Array.isArray(erros) ? erros : erros ? [erros] : [];
  const porCodigo = lista.some((erro) =>
    erro && typeof erro === "object" && String((erro as Record<string, unknown>).codigo ?? "").trim().toUpperCase() === "E0039",
  );
  return porCodigo || mensagensDosErros(erros).some((mensagem) =>
    semAcento(mensagem).includes(ASSINATURA_FORA_DO_EMISSOR_NACIONAL),
  );
}

const ASSINATURA_FORA_DO_EMISSOR_NACIONAL = "deve estar parametrizado para utilizar os emissores publicos nacionais";

export const MENSAGEM_FORA_DO_EMISSOR_NACIONAL =
  "Esta tentativa recebeu E0039 sobre a parametrização do emissor. "
  + "Confira a competência, o regime do prestador e a habilitação na Focus antes de uma nova emissão. "
  + "ME/EPP do Simples com competência a partir de 01/11/2026 utiliza o Emissor Público Nacional; "
  + "os demais casos seguem o autorizador aplicável ao município.";

/**
 * Complemento do E0039 para Lucena. Não reinterpreta o retorno: diz só o que
 * ele indica e onde se resolve — a habilitação não está no ERP.
 */
export const MENSAGEM_FORA_DO_EMISSOR_NACIONAL_LUCENA =
  "Esta tentativa recebeu E0039: o Sistema Nacional não aceitou o município emissor desta DPS. "
  + "Em Lucena/PB, isso depende da habilitação do prestador no Ambiente Nacional, que não é feita pelo ERP: "
  + "confirme-a com a Focus. Reenviar igual repete a recusa.";

/** O complemento do E0039 do município do prestador. */
export function mensagemForaDoEmissorNacional(lucena: boolean): string {
  return lucena ? MENSAGEM_FORA_DO_EMISSOR_NACIONAL_LUCENA : MENSAGEM_FORA_DO_EMISSOR_NACIONAL;
}

/**
 * A recusa de João Pessoa que manda usar o padrão Nacional. Chega com o código
 * genérico L999 — quem identifica é a mensagem, não o código.
 */
export function detectarEmissorMunicipalEncerrado(erros: unknown): boolean {
  return mensagensDosErros(erros).some((mensagem) =>
    semAcento(mensagem).includes(ASSINATURA_EMISSOR_ENCERRADO),
  );
}

// ---------------------------------------------------------------------------
// Lucena/PB
//
// O emissor municipal de Lucena (Tinus) não é integrado ao ERP. A nota do
// Simples Nacional (ME/EPP) sai pelo Ambiente Nacional via Focus `/v2/nfsen`.
//
// A Resolução CGSN nº 191/2026 torna o Emissor Nacional obrigatório para o
// Simples em 01/11/2026. Essa data NÃO é condição técnica aqui: antes dela a
// tentativa também vai, e quem decide se o prestador está habilitado é o
// autorizador. A recusa dele chega inteira ao usuário — o ERP não a presume.
//
// Regime normal (CRT 3) fica fora: não há integração para ele em Lucena.
// ---------------------------------------------------------------------------

export const AVISO_LUCENA_EMISSAO_ANTECIPADA =
  "A emissão antecipada depende da habilitação do prestador no Ambiente Nacional. "
  + "Caso não esteja disponível, a Focus retornará o motivo da recusa.";

function regraLucena(regime: string, data: string): PoliticaNFSe | null {
  if (regime !== "1" && regime !== "2") return null;
  const politica = nacional(
    regime,
    data,
    "LUCENA_SIMPLES_NACIONAL",
    "Lucena/PB — emissão pelo Ambiente Nacional via Focus NFe.",
  );
  return data < INICIO_NACIONAL_SIMPLES ? { ...politica, aviso: AVISO_LUCENA_EMISSAO_ANTECIPADA } : politica;
}

/** A regra que decidiu é de Lucena. */
export function politicaDeLucena(politica: Partial<Pick<PoliticaNFSe, "regra">> | null | undefined): boolean {
  return String(politica?.regra ?? "").startsWith("LUCENA_");
}

// ---------------------------------------------------------------------------

/** DPS nacional pelo Emissor Público Nacional (Focus `/v2/nfsen`). */
function nacional(regime: string, data: string, regra: string, motivo: string): PoliticaNFSe {
  return {
    modelo: "NACIONAL",
    layout: "DPS_NACIONAL",
    autorizador: "FOCUS_NACIONAL",
    usaDps: true,
    exigeRtc: rtcObrigatorio(regime, data),
    regra,
    motivo,
  };
}

/**
 * Regime regular informa IBS/CBS desde 2026; o Simples, a partir de 2027.
 * Regime em branco é tratado como regular: o cadastro incompleto já bloqueia a
 * emissão pelas pendências, e exigir mais nunca deixa sair nota errada.
 */
export function rtcObrigatorio(regimeTributario: unknown, dataCompetencia: string): boolean {
  const regime = String(regimeTributario ?? "").trim();
  const simples = regime === "1" || regime === "2" || regime === "4";
  return simples ? dataCompetencia >= INICIO_RTC_SIMPLES : true;
}

/** Normaliza "1401", "14.01" e "14.01.01" para "14.01". */
export function normalizarItemListaServico(valor: unknown): string | null {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.length < 3) return null;
  const item = digitos.length === 3 ? `0${digitos}` : digitos.slice(0, 4);
  return `${item.slice(0, 2)}.${item.slice(2, 4)}`;
}

export function resolverPoliticaNFSe(entrada: EntradaPoliticaNFSe): PoliticaNFSe | null {
  const municipio = String(entrada.codigoMunicipio ?? "").replace(/\D/g, "");
  const regime = String(entrada.regimeTributario ?? "").trim();
  const data = String(entrada.dataCompetencia ?? "").slice(0, 10);
  if (!dataFiscalValida(data)) {
    throw new Error("A política da NFS-e precisa da data de competência no formato AAAA-MM-DD.");
  }
  const itens = (entrada.itensListaServico ?? [])
    .map(normalizarItemListaServico)
    .filter((item): item is string => Boolean(item));

  if (regime === "4") {
    return nacional(regime, data, "MEI_NACIONAL", "MEI emite no padrão Nacional.");
  }
  // Precede municípios e exceções de itens: nenhuma regra municipal pode
  // sobrepor o art. 59, § 1º da Resolução CGSN 140 (redação CGSN 191/2026).
  // https://www.gov.br/nfse/pt-br/noticias/nfs-e-informa-diretrizes-sobre-a-obrigatoriedade-da-emissao-da-nfs-e-nacional-para-optantes-do-simples-nacional/
  if ((regime === "1" || regime === "2") && data >= INICIO_NACIONAL_SIMPLES) {
    const regra = municipio === IBGE_JOAO_PESSOA ? "JOAO_PESSOA_SIMPLES_NACIONAL"
      : municipio === IBGE_LUCENA ? "LUCENA_SIMPLES_NACIONAL" : "SIMPLES_NACIONAL_CGSN_191";
    return nacional(regime, data, regra,
      "ME/EPP do Simples Nacional: competência a partir de 01/11/2026 exige o Emissor Público Nacional (CGSN 191/2026).");
  }
  if (municipio === IBGE_JOAO_PESSOA) return regraJoaoPessoa(regime, data, itens);
  if (municipio === IBGE_CABEDELO) {
    return {
      modelo: "MUNICIPAL_CABEDELO",
      layout: "MUNICIPAL_LEGADO",
      autorizador: "FOCUS_MUNICIPAL",
      usaDps: false,
      exigeRtc: false,
      regra: "CABEDELO_MUNICIPAL",
      motivo: "Emissor municipal de Cabedelo.",
    };
  }
  if (municipio === IBGE_LUCENA) return regraLucena(regime, data);
  return null;
}

export type ContextoEmissaoNFSe = {
  politica: PoliticaNFSe;
  modeloEmissao: NFSeModeloEmissao;
  /** O padrão cadastrado para ESTE modelo, ou null. Nunca o de outro modelo. */
  padraoFiscal: Record<string, unknown> | null;
  /** O modelo escolhido não tem padrão cadastrado — a tela precisa avisar. */
  padraoAusente: boolean;
};

function padraoPreenchido(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const preenchido = Object.values(valor as Record<string, unknown>)
    .some((campo) => campo !== null && campo !== undefined && String(campo).trim() !== "");
  return preenchido ? valor as Record<string, unknown> : null;
}

/**
 * Modelo e padrão fiscal de UMA emissão, a partir dos serviços que vão nela.
 *
 * É a regra única de "qual emissor e quais códigos pré-preenchidos": a tela
 * chama (pela rota de contexto) ao abrir a revisão, e a emissão chama de novo
 * com a mesma seleção antes de enviar. Por isso recebe os itens SELECIONADOS —
 * com os da OS inteira, uma OS que mistura 01.03 e 14.01 abria a revisão no
 * Nacional enquanto a emissão de só 01.03 saía pelo municipal.
 *
 * Serviço sem item no cadastro usa o item do padrão municipal da empresa, só
 * para decidir a exceção de João Pessoa. Os códigos de um modelo nunca
 * preenchem outro: CNAE, item da LC 116 e natureza da operação não são os
 * códigos da DPS Nacional, então sem `padroes_emissao.NACIONAL` o padrão vem
 * null e a tela avisa.
 */
export function resolverContextoEmissaoNFSe(entrada: {
  empresa: { codigomunicipio?: unknown; regimetributario?: unknown } | null | undefined;
  /** Item da LC 116 do cadastro de cada serviço selecionado. */
  itensListaServico: Array<unknown>;
  dataCompetencia: string;
  padroesEmissao: unknown;
}): ContextoEmissaoNFSe | null {
  const padroes = entrada.padroesEmissao && typeof entrada.padroesEmissao === "object" && !Array.isArray(entrada.padroesEmissao)
    ? entrada.padroesEmissao as Record<string, unknown>
    : {};
  const padraoMunicipal = padraoPreenchido(padroes.MUNICIPAL_JOAO_PESSOA) ?? padraoPreenchido(padroes.MUNICIPAL_CABEDELO);
  const itemPadrao = String(padraoMunicipal?.itemListaServico ?? "");

  const politica = resolverPoliticaNFSe({
    codigoMunicipio: entrada.empresa?.codigomunicipio,
    regimeTributario: entrada.empresa?.regimetributario,
    dataCompetencia: entrada.dataCompetencia,
    itensListaServico: entrada.itensListaServico.map((item) => String(item ?? "").trim() || itemPadrao),
  });
  if (!politica) return null;

  const padraoFiscal = padraoPreenchido(padroes[politica.modelo]);
  return { politica, modeloEmissao: politica.modelo, padraoFiscal, padraoAusente: padraoFiscal === null };
}

/** O item da LC 116 do cadastro de cada linha de serviço (`osservico.servico`). */
export function itensListaDosServicos(
  itens: Array<{ servico?: unknown } | null | undefined>,
): unknown[] {
  return itens.map((item) => (item?.servico as { itemlistaservico?: unknown } | null | undefined)?.itemlistaservico ?? null);
}

/**
 * `resolverContextoEmissaoNFSe` com as recusas que as rotas devolvem ao
 * usuário — empresa sem IBGE e município sem emissor configurado.
 */
export function contextoEmissaoOuErro(
  entrada: Parameters<typeof resolverContextoEmissaoNFSe>[0],
): { ok: true; contexto: ContextoEmissaoNFSe } | { ok: false; message: string } {
  const codigoMunicipio = String(entrada.empresa?.codigomunicipio ?? "").replace(/\D/g, "");
  if (codigoMunicipio.length !== 7) {
    return { ok: false, message: "Preencha o código IBGE do município da empresa com 7 dígitos antes de emitir a NFS-e." };
  }
  const contexto = resolverContextoEmissaoNFSe(entrada);
  if (!contexto) {
    return { ok: false, message: `A emissão municipal ainda não está configurada para o município IBGE ${codigoMunicipio}.` };
  }
  return { ok: true, contexto };
}

export const MENSAGEM_PADRAO_NACIONAL_AUSENTE =
  "O padrão fiscal da NFS-e Nacional ainda não foi configurado para esta empresa. "
  + "Preencha os códigos fiscais necessários em Configurações > Fiscal > NFS-e.";

/**
 * Modelos cujo padrão a empresa pode precisar ter cadastrado hoje — o vigente
 * para a operação comum e, durante a transição de João Pessoa, também o
 * municipal, que segue valendo para os itens de exceção.
 */
export function modelosPossiveisNFSe(
  empresa: { codigomunicipio?: unknown; regimetributario?: unknown } | null | undefined,
  dataCompetencia: string,
): NFSeModeloEmissao[] {
  const base = { codigoMunicipio: empresa?.codigomunicipio, regimeTributario: empresa?.regimetributario, dataCompetencia };
  const comum = resolverPoliticaNFSe(base)?.modelo;
  const excecao = resolverPoliticaNFSe({ ...base, itensListaServico: [ITENS_EMISSOR_MUNICIPAL_JOAO_PESSOA[0]] })?.modelo;
  return [...new Set([comum, excecao].filter((modelo): modelo is NFSeModeloEmissao => Boolean(modelo)))];
}

/** O dia corrente no fuso da empresa — a única fonte de "hoje" da NFS-e. */
export function dataDoDiaNFSe(agora: Date, timezoneIana?: string | null): string {
  const timeZone = String(timezoneIana ?? "").trim() || "America/Fortaleza";
  return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(agora);
}

function dataFiscalValida(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const instante = new Date(`${data}T12:00:00Z`);
  return Number.isFinite(instante.getTime()) && instante.toISOString().slice(0, 10) === data;
}

/** Competência da tentativa original: reenviar em novembro não transforma outubro em novembro. */
export function competenciaDoRegistroNFSe(payload: unknown, dataEmissao: unknown, timezoneIana?: string | null): string {
  const dados = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (dados.data_competencia !== undefined) {
    const competencia = String(dados.data_competencia);
    if (!dataFiscalValida(competencia)) throw new Error("A competência gravada na NFS-e é inválida. Revise a emissão.");
    return competencia;
  }
  // RPS legado não guarda dCompet separado; sua data original nunca é
  // substituída por 'hoje' para decidir a transição do autorizador.
  const valor = dados.data_emissao ?? dataEmissao;
  if (typeof valor === "string" && dataFiscalValida(valor)) return valor;
  // Focus municipal registra horário local sem TZD. Interpretá-lo no fuso
  // do servidor mudaria o dia perto da meia-noite em instalações UTC.
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(valor)
      && dataFiscalValida(valor.slice(0, 10))) return valor.slice(0, 10);
  const instante = typeof valor === "string" ? new Date(valor) : new Date(NaN);
  if (!Number.isFinite(instante.getTime())) throw new Error("Esta NFS-e não guarda uma competência ou data original válida. Revise a emissão.");
  return dataDoDiaNFSe(instante, timezoneIana);
}

/**
 * Endpoint de uma nota JÁ emitida: sai do `modelo_emissao` gravado nela, nunca
 * da política de hoje. Uma nota municipal antiga continua sendo consultada,
 * cancelada e reenviada em `/v2/nfse`, e uma Nacional em `/v2/nfsen`, por mais
 * que a regra de emissão mude depois. Valor desconhecido ou nulo (as notas de
 * maio/2026 gravaram só "MUNICIPAL") é municipal.
 */
export function familiaDoModeloNFSe(modeloEmissao: unknown): "NACIONAL" | "MUNICIPAL" {
  return String(modeloEmissao ?? "").trim().toUpperCase() === "NACIONAL" ? "NACIONAL" : "MUNICIPAL";
}

/**
 * "Reenviar sem alterar" repete o envio no autorizador em que a nota nasceu. Ele
 * é recusado — devolvendo o motivo — quando repetir só traria a mesma recusa:
 *
 * - a nota municipal levou o L999 de emissor encerrado, ou a operação hoje já
 *   não é municipal;
 * - a tentativa levou E0039: o reenvio exato permanece bloqueado para
 *   preservar a rejeição histórica; uma nova emissão usa a política vigente;
 * - a operação hoje usa outra família de endpoint/layout.
 *
 * Fora disso a nota volta pelo mesmo caminho — uma Nacional legítima (MEI)
 * continua no `/v2/nfsen`. `politicaHoje` nula (sem empresa) não bloqueia.
 */
export function motivoParaNaoReenviar(
  nota: { modelo_emissao?: unknown; autorizador_emissao?: unknown; erros?: unknown },
  politicaHoje: (Pick<PoliticaNFSe, "modelo" | "autorizador"> & Partial<Pick<PoliticaNFSe, "regra">>) | null | undefined,
): string | null {
  if (nota.autorizador_emissao && politicaHoje
      && nota.autorizador_emissao !== politicaHoje.autorizador) {
    return "O autorizador desta tentativa difere do exigido para sua competência. Revise e emita uma nova nota pelo destino correto.";
  }
  if (detectarMunicipioForaDoEmissorNacional(nota.erros)) {
    return mensagemForaDoEmissorNacional(politicaDeLucena(politicaHoje));
  }
  if (familiaDoModeloNFSe(nota.modelo_emissao) === "NACIONAL") {
    if (politicaHoje && politicaHoje.modelo !== "NACIONAL") return MENSAGEM_EMISSOR_NACIONAL_EXIGIDO;
    return null;
  }
  if (detectarEmissorMunicipalEncerrado(nota.erros)) return MENSAGEM_EMISSOR_NACIONAL_EXIGIDO;
  if (politicaHoje && politicaHoje.autorizador !== "FOCUS_MUNICIPAL") return MENSAGEM_EMISSOR_NACIONAL_EXIGIDO;
  return null;
}

/** Compatível com o uso anterior: o reenvio não pode repetir o mesmo caminho. */
export function reenvioExigeNovoModelo(
  nota: { modelo_emissao?: unknown; erros?: unknown },
  modeloVigente: NFSeModeloEmissao | null | undefined,
): boolean {
  if (familiaDoModeloNFSe(nota.modelo_emissao) === "NACIONAL") {
    return detectarMunicipioForaDoEmissorNacional(nota.erros);
  }
  return detectarEmissorMunicipalEncerrado(nota.erros) || modeloVigente === "NACIONAL";
}

/** Rótulo do destino da nota, para cabeçalhos e configurações. */
export function rotuloPoliticaNFSe(
  politica: (Pick<PoliticaNFSe, "modelo" | "autorizador"> & Partial<Pick<PoliticaNFSe, "regra">>) | null | undefined,
): string {
  if (!politica) return rotuloModeloNFSe(null);
  if (politica.autorizador === "FOCUS_FORMATO_NACIONAL_MUNICIPAL") return "NFS-e João Pessoa · Formato Nacional via Focus";
  if (politicaDeLucena(politica)) return "NFS-e Nacional — Lucena/PB via Focus NFe";
  return rotuloModeloNFSe(politica.modelo);
}

export function rotuloModeloNFSe(modelo: NFSeModeloEmissao | null | undefined): string {
  if (modelo === "NACIONAL") return "NFS-e Nacional";
  if (modelo === "MUNICIPAL_CABEDELO") return "NFS-e Cabedelo";
  if (modelo === "MUNICIPAL_JOAO_PESSOA") return "NFS-e João Pessoa";
  return "Modelo não configurado";
}

// ---------------------------------------------------------------------------
// Leitura dos erros gravados em `nfse.erros`
// ---------------------------------------------------------------------------

function semAcento(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function mensagensDosErros(erros: unknown): string[] {
  if (!erros) return [];
  if (typeof erros === "string") return [erros];
  if (Array.isArray(erros)) return erros.flatMap(mensagensDosErros);
  if (typeof erros === "object") {
    const registro = erros as Record<string, unknown>;
    return [registro.mensagem, registro.message, registro.correcao]
      .filter((valor): valor is string => typeof valor === "string" && valor.trim() !== "");
  }
  return [];
}

/**
 * Primeiro erro legível da nota, com a explicação da migração na frente quando
 * for o caso. O retorno original da Focus vem sempre junto — a explicação
 * nunca o substitui.
 */
export function resumirErrosNFSe(
  erros: unknown,
  /** Município do prestador: escolhe o complemento do E0039. */
  codigoMunicipio?: unknown,
): { codigo: string | null; mensagem: string } | null {
  const lucena = String(codigoMunicipio ?? "").replace(/\D/g, "") === IBGE_LUCENA;
  const lista = Array.isArray(erros) ? erros : erros ? [erros] : [];
  for (const erro of lista) {
    const mensagem = mensagensDosErros(erro)[0];
    if (!mensagem) continue;
    const codigo = erro && typeof erro === "object"
      ? String((erro as Record<string, unknown>).codigo ?? "").trim() || null
      : null;
    const explicacao = detectarMunicipioForaDoEmissorNacional(erros)
      ? mensagemForaDoEmissorNacional(lucena)
      : detectarEmissorMunicipalEncerrado(erros)
        ? MENSAGEM_EMISSOR_NACIONAL_EXIGIDO
        : null;
    return { codigo, mensagem: explicacao ? `${explicacao} Retorno da Focus: ${mensagem}` : mensagem };
  }
  return null;
}
