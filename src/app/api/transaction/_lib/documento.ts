/**
 * Campos do documento relacionado a uma transacao.
 *
 * Vive aqui porque as rotas de criacao sao duas — `/api/transaction` e
 * `/api/transaction/os` — cada uma com sua propria copia do sanitizador. Uma
 * terceira copia divergiria na primeira correcao; centralizando, o pagamento de
 * OS e o lancamento avulso gravam documento exatamente do mesmo jeito.
 *
 * Nada aqui e obrigatorio, menos o tipo: sem ele, um numero solto nao diz de que
 * papel se trata, e o CHECK do banco recusa. A validacao acontece antes para a
 * tela receber uma frase em vez de uma violacao de constraint.
 */

/** Teto por campo. Nao e regra de negocio: e evitar texto colado sem limite. */
const LIMITES = {
  documento_numero: 60,
  documento_serie: 20,
  documento_chave: 120,
  documento_observacao: 500,
} as const;

const CAMPOS_TEXTO = Object.keys(LIMITES) as Array<keyof typeof LIMITES>;

export const CAMPOS_DOCUMENTO = [
  "documento_tipo_id",
  "documento_numero",
  "documento_serie",
  "documento_chave",
  "documento_emitido_em",
  "documento_valor",
  "documento_observacao",
] as const;

function textoOuNulo(valor: unknown, limite: number): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim().slice(0, limite);
  return limpo === "" ? null : limpo;
}

function inteiroOuNulo(valor: unknown): number | null {
  if (valor == null || (typeof valor === "string" && valor.trim() === "")) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : null;
}

function dinheiroOuNulo(valor: unknown): number | null {
  if (valor == null || (typeof valor === "string" && valor.trim() === "")) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 100) / 100;
}

/**
 * Data de emissao em `AAAA-MM-DD`, sem hora e sem fuso.
 *
 * A tela manda o dia ja formatado. Se vier um ISO completo, ficam os dez
 * primeiros caracteres — que sao a data em UTC, nao no fuso de quem digitou.
 * Por isso a tela nunca manda ISO: seria o mesmo "um dia a menos" que ja
 * apareceu na migracao de dados.
 */
function diaOuNulo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const dia = valor.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  return Number.isNaN(new Date(`${dia}T12:00:00Z`).getTime()) ? null : dia;
}

/**
 * Copia para `saida` os campos de documento presentes em `body`, ja coeridos.
 *
 * Chave ausente no corpo continua ausente na saida: numa criacao isso evita
 * gravar sete nulos a toa, e num PATCH evita apagar o que nao foi enviado.
 */
export function aplicarCamposDocumento(body: unknown, saida: Record<string, unknown>) {
  if (!body || typeof body !== "object") return saida;
  const origem = body as Record<string, unknown>;

  for (const campo of CAMPOS_DOCUMENTO) {
    if (!(campo in origem)) continue;

    if (campo === "documento_tipo_id") saida[campo] = inteiroOuNulo(origem[campo]);
    else if (campo === "documento_valor") saida[campo] = dinheiroOuNulo(origem[campo]);
    else if (campo === "documento_emitido_em") saida[campo] = diaOuNulo(origem[campo]);
    else saida[campo] = textoOuNulo(origem[campo], LIMITES[campo]);
  }

  return saida;
}

/**
 * Mensagem de recusa, ou `null` quando o documento esta coerente.
 *
 * Espelha o CHECK `transacao_documento_tipo_obrigatorio`. Existe em dobro de
 * proposito: o banco garante o dado, a rota garante a frase.
 */
export function erroDeDocumento(saida: Record<string, unknown>): string | null {
  if (saida.documento_tipo_id != null) return null;

  const temOutroCampo = CAMPOS_TEXTO.some((campo) => saida[campo] != null)
    || saida.documento_emitido_em != null
    || saida.documento_valor != null;

  return temOutroCampo ? "Selecione o tipo do documento relacionado." : null;
}
