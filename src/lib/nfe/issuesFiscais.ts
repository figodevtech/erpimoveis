export type IssueFiscalClassificavel = {
  severidade?: string | null;
  requerCiencia?: boolean | null;
};

export type IssueComFingerprint = IssueFiscalClassificavel & {
  code: string;
  fingerprint?: string | null;
};

export type ItemComCienciaFiscal = {
  cfop?: unknown;
  cst?: unknown;
  csosn?: unknown;
  /** Chaves `code@fingerprint` (veja `chaveCiencia`). */
  avisosFiscaisConfirmados: readonly string[];
};

const CAMPOS_QUE_INVALIDAM_CIENCIA = ["cfop", "cst", "csosn"] as const;

/**
 * Regra única de apresentação das issues fiscais.
 *
 * Issues antigas da validação estrutural não carregam severidade; por
 * segurança, elas continuam sendo bloqueios. `requerCiencia` identifica um
 * aviso pendente, mas nunca rebaixa um BLOQUEIO/ERRO explícito.
 */
export function classificarIssuesFiscais<T extends IssueFiscalClassificavel>(
  issues: readonly T[],
) {
  const bloqueios: T[] = [];
  const avisosComCiencia: T[] = [];
  const informativos: T[] = [];

  for (const issue of issues) {
    const severidade = String(issue.severidade ?? "").trim().toUpperCase();

    if (severidade === "BLOQUEIO" || severidade === "ERRO") {
      bloqueios.push(issue);
    } else if (issue.requerCiencia === true) {
      avisosComCiencia.push(issue);
    } else if (["AVISO", "INFO", "INFORMACAO", "INFORMAÇÃO", "INFORMATIVO"].includes(severidade)) {
      informativos.push(issue);
    } else {
      bloqueios.push(issue);
    }
  }

  return {
    bloqueios,
    avisosComCiencia,
    /** Alias temporário para os consumidores existentes. Contém só ciência. */
    avisos: avisosComCiencia,
    informativos,
    pronto: bloqueios.length === 0 && avisosComCiencia.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Ciência vinculada à situação analisada
//
// Confirmar um aviso vale para os dados que o produziram, não para o código.
// Cada regra que pede ciência monta o fingerprint com os campos que decidiram
// o aviso e a versão da regra; a ciência guardada é `code@fingerprint`. Se
// qualquer um desses dados muda, a chave muda e o aviso volta a pedir ciência.
//
// O servidor recalcula o fingerprint a partir do payload e só aceita a chave
// igual à que ele mesmo calculou. Uma confirmação antiga, só com o código, não
// casa com nenhuma chave e não libera nada.
// ---------------------------------------------------------------------------

function canonico(valor: unknown): unknown {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (Array.isArray(valor)) return valor.map(canonico);
  if (typeof valor === "object") {
    return Object.fromEntries(
      Object.keys(valor as Record<string, unknown>)
        .sort()
        .map((chave) => [chave, canonico((valor as Record<string, unknown>)[chave])]),
    );
  }
  return valor;
}

/** cyrb53: hash síncrono, igual no navegador e no Node. Não é criptográfico, nem precisa. */
function cyrb53(texto: string, semente: number) {
  let h1 = 0xdeadbeef ^ semente;
  let h2 = 0x41c6ce57 ^ semente;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, "0");
}

/** Fingerprint estável dos dados que produziram uma issue. A ordem das chaves não importa. */
export function fingerprintFiscal(dados: Record<string, unknown>): string {
  const texto = JSON.stringify(canonico(dados));
  return `fp1.${cyrb53(texto, 0)}${cyrb53(texto, 0x9e3779b9)}`;
}

/** Chave gravada quando o usuário confirma o aviso; `null` se o aviso não admite ciência. */
export function chaveCiencia(issue: IssueComFingerprint): string | null {
  const severidade = String(issue.severidade ?? "").trim().toUpperCase();
  if (issue.requerCiencia !== true || severidade === "BLOQUEIO" || severidade === "ERRO") return null;
  const fingerprint = String(issue.fingerprint ?? "").trim();
  return fingerprint ? `${issue.code}@${fingerprint}` : null;
}

/** O aviso foi confirmado para exatamente esta situação? */
export function avisoFiscalConfirmado(
  issue: IssueComFingerprint,
  confirmados: Iterable<string>,
): boolean {
  const chave = chaveCiencia(issue);
  if (!chave) return false;
  for (const confirmado of confirmados) if (confirmado === chave) return true;
  return false;
}

/** Marca ou desmarca a ciência de um aviso na lista do item. */
export function alternarCienciaFiscal(
  confirmados: readonly string[],
  issue: IssueComFingerprint,
  confirmar: boolean,
): string[] {
  const chave = chaveCiencia(issue);
  if (!chave) return [...confirmados];
  const semEsta = confirmados.filter((valor) => valor !== chave);
  return confirmar ? [...semEsta, chave] : semEsta;
}

/**
 * A ciência vale para a combinação tributária conferida. Alterar CFOP,
 * CST ou CSOSN limpa as confirmações. Os demais dados relevantes (ST ativada,
 * base, frete, desconto...) entram no fingerprint e invalidam a ciência sem
 * precisar limpar a lista.
 */
export function aplicarAlteracoesComCienciaFiscal<T extends ItemComCienciaFiscal>(
  item: T,
  alteracoes: Partial<T>,
): T {
  const mudouClassificacao = CAMPOS_QUE_INVALIDAM_CIENCIA.some(
    (campo) =>
      Object.prototype.hasOwnProperty.call(alteracoes, campo) &&
      alteracoes[campo] !== item[campo],
  );

  return {
    ...item,
    ...alteracoes,
    ...(mudouClassificacao ? { avisosFiscaisConfirmados: [] } : {}),
  } as T;
}

/**
 * Registra a ciência dada no fechamento da emissão. Só entram avisos que pedem
 * ciência e têm fingerprint: INFO e BLOQUEIO nunca viram confirmação.
 */
export function confirmarAvisosFiscais<T extends ItemComCienciaFiscal>(
  item: T,
  avisos: readonly IssueComFingerprint[],
): T {
  const confirmados = [
    ...new Set([
      ...item.avisosFiscaisConfirmados,
      ...avisos.map(chaveCiencia).filter((chave): chave is string => Boolean(chave)),
    ]),
  ];

  if (
    confirmados.length === item.avisosFiscaisConfirmados.length &&
    confirmados.every((chave, index) => chave === item.avisosFiscaisConfirmados[index])
  ) {
    return item;
  }

  return { ...item, avisosFiscaisConfirmados: confirmados };
}
