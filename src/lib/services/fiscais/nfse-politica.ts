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

export type NFSeModeloEmissao = "NACIONAL" | "MUNICIPAL_CABEDELO" | "MUNICIPAL_JOAO_PESSOA";

export type PoliticaNFSe = {
  modelo: NFSeModeloEmissao;
  /** O envio é uma DPS do padrão Nacional (`/v2/nfsen`), não um RPS municipal. */
  usaDps: boolean;
  /** CST, cClassTrib, cIndOp e os indicadores da Reforma são exigidos na emissão. */
  exigeRtc: boolean;
  /** Identificador estável da regra que decidiu — vai para log e teste. */
  regra: string;
  /** Explicação curta, para tela e diagnóstico. */
  motivo: string;
};

export type EntradaPoliticaNFSe = {
  codigoMunicipio: unknown;
  regimeTributario: unknown;
  /** Dia da emissão no fuso da empresa, AAAA-MM-DD. */
  dataCompetencia: string;
  /**
   * Itens da LC 116 dos serviços da nota. A nota é consolidada, então vale o
   * conjunto: só fica no emissor de exceção se TODOS forem exceção.
   */
  itensListaServico?: Array<string | null | undefined>;
};

const IBGE_JOAO_PESSOA = "2507507";
const IBGE_CABEDELO = "2503209";

/**
 * Simples Nacional (ME/EPP) passa a emitir no padrão Nacional.
 * Resolução CGSN nº 191/2026, que adiou de setembro para novembro o prazo da
 * CGSN nº 189/2026. Hoje só a regra de João Pessoa usa esta data — ver
 * `regraJoaoPessoa`.
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
    modelo: "MUNICIPAL_JOAO_PESSOA", usaDps: false, exigeRtc: false, regra, motivo,
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

  return nacional(
    regime,
    data,
    "JOAO_PESSOA_NACIONAL",
    "João Pessoa exige o padrão Nacional para esta operação desde 01/10/2026.",
  );
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

function nacional(regime: string, data: string, regra: string, motivo: string): PoliticaNFSe {
  return { modelo: "NACIONAL", usaDps: true, exigeRtc: rtcObrigatorio(regime, data), regra, motivo };
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error("A política da NFS-e precisa da data de competência no formato AAAA-MM-DD.");
  }
  const itens = (entrada.itensListaServico ?? [])
    .map(normalizarItemListaServico)
    .filter((item): item is string => Boolean(item));

  if (regime === "4") {
    return nacional(regime, data, "MEI_NACIONAL", "MEI emite no padrão Nacional.");
  }
  if (municipio === IBGE_JOAO_PESSOA) return regraJoaoPessoa(regime, data, itens);
  if (municipio === IBGE_CABEDELO) {
    return {
      modelo: "MUNICIPAL_CABEDELO",
      usaDps: false,
      exigeRtc: false,
      regra: "CABEDELO_MUNICIPAL",
      motivo: "Emissor municipal de Cabedelo.",
    };
  }
  return null;
}

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
 * "Reenviar sem alterar" repete o envio no modelo em que a nota nasceu — e isso
 * não adianta quando a nota é municipal e a prefeitura já mandou usar o
 * Nacional, ou quando a política de hoje leva a operação para o Nacional.
 * Nota Nacional nunca é bloqueada aqui: ela volta ao `/v2/nfsen`.
 */
export function reenvioExigeNovoModelo(
  nota: { modelo_emissao?: unknown; erros?: unknown },
  modeloVigente: NFSeModeloEmissao | null | undefined,
): boolean {
  if (familiaDoModeloNFSe(nota.modelo_emissao) === "NACIONAL") return false;
  return detectarEmissorMunicipalEncerrado(nota.erros) || modeloVigente === "NACIONAL";
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
export function resumirErrosNFSe(erros: unknown): { codigo: string | null; mensagem: string } | null {
  const lista = Array.isArray(erros) ? erros : erros ? [erros] : [];
  for (const erro of lista) {
    const mensagem = mensagensDosErros(erro)[0];
    if (!mensagem) continue;
    const codigo = erro && typeof erro === "object"
      ? String((erro as Record<string, unknown>).codigo ?? "").trim() || null
      : null;
    return {
      codigo,
      mensagem: detectarEmissorMunicipalEncerrado(erros)
        ? `${MENSAGEM_EMISSOR_NACIONAL_EXIGIDO} Retorno da Focus: ${mensagem}`
        : mensagem,
    };
  }
  return null;
}
