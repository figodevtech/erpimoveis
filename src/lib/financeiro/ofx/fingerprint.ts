/**
 * A identidade de um movimento de extrato.
 *
 * O problema que isto resolve: reimportar um extrato com período sobreposto não
 * pode duplicar movimento, e o `FITID` — que existe no formato exatamente para
 * isso — não serve, nem sozinho nem como parte da chave. Os bancos falham com
 * ele dos dois lados:
 *
 *   - há extrato que repete o mesmo `FITID` em movimentos diferentes, então
 *     usá-lo sozinho descartaria movimento de verdade;
 *   - o C6 gera um `FITID` novo a cada exportação (ele começa com o id do
 *     arquivo), então com ele na chave o mesmo movimento, em duas exportações,
 *     vira dois — e a linha já conciliada volta como pendente.
 *
 * A chave é o resto do que o banco disse sobre a linha — conta, data, valor com
 * sinal, tipo, CHECKNUM, REFNUM, NAME e MEMO —, mais a ocorrência dela dentro
 * do arquivo. A ocorrência é o que separa dois movimentos REALMENTE idênticos
 * no mesmo dia (duas tarifas de R$ 2,90, mesma data, mesmo memo) — que são dois
 * fatos, não um repetido.
 *
 * O `FITID` continua gravado em `ofx_movimento`, como informação.
 */

import { createHash } from "node:crypto";

import { normalizarTexto } from "./normalize";
import type { OfxCabecalho, OfxExtrato, OfxMovimento } from "./types";

/**
 * A conta, na visão do arquivo.
 *
 * Entra na chave para que o mesmo movimento de duas contas do mesmo banco não
 * colida. Fica aqui, e não no banco_id do ERP, porque o fingerprint precisa ser
 * uma função do arquivo: a unicidade contra o ERP é feita pela restrição
 * `UNIQUE (banco_id, fingerprint)` no banco de dados.
 */
function chaveDaConta(cabecalho: OfxCabecalho): string {
  return [cabecalho.bankId, cabecalho.branchId, cabecalho.acctId]
    .map((parte) => normalizarTexto(parte))
    .join("/");
}

/**
 * Tudo que identifica a linha, menos a ocorrência.
 *
 * Duas linhas com a mesma chave base são indistinguíveis pelo que o banco
 * informou — e é só aí que a ocorrência precisa desempatar.
 */
export function chaveBaseDoMovimento(cabecalho: OfxCabecalho, movimento: OfxMovimento): string {
  return [
    chaveDaConta(cabecalho),
    movimento.dataPostagem,
    // Com sinal: o mesmo valor entrando e saindo são movimentos opostos, nunca
    // o mesmo.
    String(movimento.valorCentavos),
    normalizarTexto(movimento.tipoOfx),
    // Sem FITID: ver o comentário do topo.
    normalizarTexto(movimento.checknum),
    normalizarTexto(movimento.refnum),
    normalizarTexto(movimento.nome),
    normalizarTexto(movimento.memo),
  ].join("|");
}

function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/**
 * Os fingerprints do extrato, na ordem dos movimentos.
 *
 * A ocorrência é contada sobre a chave base, não sobre a posição no arquivo: um
 * extrato reexportado com período maior mantém o mesmo fingerprint para as
 * linhas que já existiam, porque a contagem de repetições daquela chave é a
 * mesma nos dois arquivos.
 *
 * A exceção conhecida: se o segundo arquivo trouxer MAIS repetições idênticas
 * da mesma chave (o banco corrigiu o extrato), a repetição extra ganha
 * fingerprint novo e entra como movimento a analisar. É o lado seguro do erro —
 * aparece para o usuário decidir, em vez de sumir calado.
 */
export function calcularFingerprints(extrato: OfxExtrato): string[] {
  const ocorrencias = new Map<string, number>();

  return extrato.movimentos.map((movimento) => {
    const base = chaveBaseDoMovimento(extrato.cabecalho, movimento);
    const ocorrencia = (ocorrencias.get(base) ?? 0) + 1;
    ocorrencias.set(base, ocorrencia);
    return sha256(`${base}|#${ocorrencia}`);
  });
}

/**
 * Hash do arquivo inteiro.
 *
 * Responde "este arquivo já foi importado?" — pergunta diferente de "este
 * movimento já foi importado?", que é o fingerprint. Depender só dele seria
 * insuficiente: o banco gera arquivos diferentes com períodos sobrepostos, e os
 * dois passariam por arquivos novos.
 */
export function hashDoArquivo(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}
