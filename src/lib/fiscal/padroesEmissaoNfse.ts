/**
 * `nfse_config.padroes_emissao`: um padrão de códigos por modelo de emissão.
 *
 * Os modelos convivem na mesma coluna — durante a transição de João Pessoa a
 * empresa usa o NACIONAL na operação comum e o MUNICIPAL_JOAO_PESSOA nas
 * exceções, e o municipal ainda descreve o histórico. Salvar um não pode
 * apagar o outro.
 *
 * Não há separação por ambiente: homologação e produção mudam o endpoint e o
 * token da Focus, não a classificação fiscal do serviço. Nenhuma outra
 * configuração fiscal do projeto (NF-e, NFC-e) separa códigos por ambiente.
 */

/**
 * Modelos que podem ter padrão gravado. Chave errada no jsonb é padrão que
 * nunca é lido: a emissão procura pelo modelo que a política resolve.
 */
export const MODELOS_PADRAO_NFSE = ["NACIONAL", "MUNICIPAL_CABEDELO", "MUNICIPAL_JOAO_PESSOA"] as const;

/**
 * Deixa o padrão pronto para a emissão usar sem retoque.
 *
 * Um espaço sobrando no CNAE ou um "1401" no lugar de "14.01" ficavam
 * guardados assim e voltavam assim para a tela de emissão — no banco da Demir o
 * CNAE estava gravado com um branco no fim. Campo vazio é descartado em vez de
 * virar string vazia, para não mascarar um padrão nunca preenchido.
 */
export function normalizarPadraoNfse(entrada: unknown): Record<string, string> | null {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return null;

  const saida: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(entrada as Record<string, unknown>)) {
    if (valor == null) continue;
    const texto = String(valor).trim();
    if (!texto) continue;
    saida[campo] = campo === "codigoCnae" ? texto.replace(/\D/g, "") : texto;
  }
  return Object.keys(saida).length > 0 ? saida : null;
}

/**
 * Junta o que a tela mandou com o que já está gravado, modelo a modelo.
 *
 * - modelo presente no envio substitui o gravado (vazio remove — é assim que
 *   se limpa um padrão);
 * - modelo ausente do envio fica como está.
 *
 * Antes a coluna era regravada inteira com o que chegasse: uma tela que
 * mostrasse só o Nacional apagaria o municipal de João Pessoa, e vice-versa.
 */
export function mesclarPadroesEmissaoNfse(atual: unknown, recebido: unknown): Record<string, unknown> {
  const gravado = atual && typeof atual === "object" && !Array.isArray(atual)
    ? { ...(atual as Record<string, unknown>) }
    : {};
  if (!recebido || typeof recebido !== "object" || Array.isArray(recebido)) return gravado;

  const envio = recebido as Record<string, unknown>;
  for (const modelo of MODELOS_PADRAO_NFSE) {
    if (!Object.prototype.hasOwnProperty.call(envio, modelo)) continue;
    const padrao = normalizarPadraoNfse(envio[modelo]);
    if (padrao) gravado[modelo] = padrao;
    else delete gravado[modelo];
  }
  return gravado;
}
