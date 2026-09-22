/**
 * Normalização e apresentação de NCM.
 *
 * Núcleo puro compartilhado pela rota de busca, pelo seletor das telas e pelos
 * testes. Não conhece banco nem React.
 */

/** Um NCM como as telas precisam dele: código, descrição e proveniência. */
export type NcmItem = {
  codigo: string;
  descricao: string;
  /**
   * Descrições dos níveis superiores, separadas por " › ".
   *
   * A NCM é hierárquica: "De sistemas de injeção" só classifica alguma coisa
   * lido junto de "Controladores eletrônicos do tipo utilizado em veículos
   * automóveis". Sem isso, um código "Outros" não diz nada.
   */
  caminho: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  ato: string | null;
  fonte: string | null;
  fonteUrl: string | null;
};

const ACENTOS = "áàâãäéèêëíìîïóòôõöúùûüñçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÑÇ";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC";

/**
 * Só os dígitos. É o que permite colar "9032.89.25" e achar "90328925" — o
 * formato com pontos é o que aparece em nota fiscal e em tabela de fornecedor.
 */
export function apenasDigitosNcm(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

/** Código completo de NCM: exatamente 8 dígitos. */
export function normalizarCodigoNcm(valor: unknown): string | null {
  const digitos = apenasDigitosNcm(valor);
  return digitos.length === 8 ? digitos : null;
}

/**
 * Tira acento e caixa, do mesmo jeito que a coluna `descricao_busca` do banco.
 * Se os dois divergirem, a busca por texto para de achar.
 */
export function normalizarTextoNcm(valor: unknown): string {
  const texto = String(valor ?? "").trim();
  let saida = "";
  for (const caractere of texto) {
    const indice = ACENTOS.indexOf(caractere);
    saida += indice >= 0 ? SEM_ACENTO[indice] : caractere;
  }
  return saida.toLowerCase();
}

/**
 * A descrição oficial às vezes traz marcação do portal, como
 * "(UHT - <i>Ultra High Temperature</i>)". Exibir isso cru mostraria as tags
 * ao usuário.
 */
export function limparDescricaoNcm(valor: unknown): string {
  return String(valor ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Formata para leitura: "9032.89.25". */
export function formatarCodigoNcm(valor: unknown): string {
  const digitos = apenasDigitosNcm(valor);
  if (digitos.length !== 8) return digitos;
  return `${digitos.slice(0, 4)}.${digitos.slice(4, 6)}.${digitos.slice(6, 8)}`;
}

/** Rótulo de uma linha: "90328925 — De sistemas de injeção". */
export function rotuloNcm(item: Pick<NcmItem, "codigo" | "descricao"> | null | undefined): string {
  if (!item?.codigo) return "";
  const descricao = limparDescricaoNcm(item.descricao);
  return descricao ? `${item.codigo} — ${descricao}` : item.codigo;
}

export type TipoBuscaNcm = "CODIGO" | "TEXTO" | "CURTA";

/**
 * O que o usuário digitou, classificado.
 *
 * Dígitos viram busca por código, inclusive parcial. Qualquer outra coisa vira
 * busca por texto. Abaixo de dois caracteres não busca nada: com 10.515 linhas,
 * uma letra devolveria ruído e faria o servidor trabalhar à toa.
 */
export function classificarBuscaNcm(termo: unknown): {
  tipo: TipoBuscaNcm;
  codigo: string;
  /** Normalizado (sem acento, minúsculo), para casar com `descricao_busca`. */
  texto: string;
  /** Como veio digitado, para quem precisar comparar com a descrição crua. */
  textoOriginal: string;
} {
  const bruto = String(termo ?? "").trim();
  const digitos = apenasDigitosNcm(bruto);

  // "9032.89.25" e "9032 89 25" são código; "sistema 3" não é.
  const soDigitosEPontuacao = bruto.length > 0 && /^[\d.\-/\s]+$/.test(bruto);

  if (soDigitosEPontuacao && digitos.length >= 2) {
    return { tipo: "CODIGO", codigo: digitos.slice(0, 8), texto: "", textoOriginal: bruto };
  }
  const texto = normalizarTextoNcm(bruto);
  if (texto.length < 2) return { tipo: "CURTA", codigo: "", texto, textoOriginal: bruto };
  return { tipo: "TEXTO", codigo: "", texto, textoOriginal: bruto };
}

/**
 * Prefixo para sugerir vizinhos de um código de 8 dígitos que não existe.
 *
 * Seis dígitos é a subposição do Sistema Harmonizado: os códigos que a
 * compartilham são de fato da mesma família, não uma semelhança inventada.
 * Quem digitou 90328920 provavelmente queria algum 903289xx.
 */
export function prefixoDeSugestaoNcm(codigo: string): string | null {
  const digitos = apenasDigitosNcm(codigo);
  return digitos.length === 8 ? digitos.slice(0, 6) : null;
}

/**
 * Um NCM vale na data? Vigência inclusiva nos dois extremos, igual à do motor
 * de DIFAL. Sem `vigencia_inicio` o item é tratado como vigente: a ausência é
 * do dado importado, não uma afirmação de que ainda não valia.
 */
export function ncmVigenteEm(
  item: Pick<NcmItem, "vigenciaInicio" | "vigenciaFim">,
  data: string,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return true;
  if (item.vigenciaInicio && data < item.vigenciaInicio) return false;
  if (item.vigenciaFim && data > item.vigenciaFim) return false;
  return true;
}

/**
 * Ordena o resultado da busca por código com o exato primeiro.
 *
 * Quem colou 90328925 quer aquele código, não o primeiro 903289xx em ordem
 * alfabética.
 */
export function ordenarResultadoNcm(itens: NcmItem[], codigoExato: string): NcmItem[] {
  if (!codigoExato) return itens;
  return [...itens].sort((a, b) => {
    if (a.codigo === codigoExato) return -1;
    if (b.codigo === codigoExato) return 1;
    return a.codigo.localeCompare(b.codigo);
  });
}
