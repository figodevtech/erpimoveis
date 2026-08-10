import "server-only";

import {
  normalizarPadraoFiscalItem,
  validarPadraoFiscalItem,
  type PadraoFiscalIssue,
  type PadraoFiscalItem,
} from "@/lib/nfe/padraoFiscalItem";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ClassificacaoTributariaRtc, CRT } from "@/lib/nfe/types";

/**
 * Guarda e valida o padrão fiscal dos itens gravado em
 * `nfe_config.padroes_emissao`.
 *
 * O jsonb é `{ "SAIDA": {…}, "ENTRADA": {…} }` dentro da linha do modelo — a
 * linha NFE guarda o padrão da 55 e a NFCE o da 65. A NFC-e só usa SAIDA.
 */
export type TipoOperacaoPadrao = "SAIDA" | "ENTRADA";

export const OPERACOES_PADRAO: TipoOperacaoPadrao[] = ["SAIDA", "ENTRADA"];

export type PadroesPorOperacao = Partial<Record<TipoOperacaoPadrao, PadraoFiscalItem>>;

export type PadraoFiscalIssueLocalizada = PadraoFiscalIssue & {
  operacao: TipoOperacaoPadrao;
};

/**
 * Classificações IBS/CBS vigentes hoje, indexadas por `cClassTrib`.
 *
 * Mesma consulta que `salvarNFeAvulsaDraft` faz na emissão: a tabela oficial
 * tem vigência, e um código válido no ano passado pode não valer mais.
 */
async function carregarClassificacoesVigentes(
  codigos: string[],
): Promise<Map<string, ClassificacaoTributariaRtc>> {
  if (codigos.length === 0) return new Map();

  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("fiscal_nfe_classificacao_tributaria")
    .select("codigo, cst, nome, permite_nfe, inicio_vigencia, fim_vigencia, versao_fonte")
    .in("codigo", codigos)
    .lte("inicio_vigencia", hoje)
    .or(`fim_vigencia.is.null,fim_vigencia.gte.${hoje}`);

  if (error) throw error;

  return new Map(
    (data ?? []).map((linha: any) => [
      linha.codigo as string,
      {
        codigo: linha.codigo,
        cst: linha.cst,
        nome: linha.nome,
        inicioVigencia: linha.inicio_vigencia,
        fimVigencia: linha.fim_vigencia,
        permiteNfe: linha.permite_nfe,
        versaoFonte: linha.versao_fonte,
      } as ClassificacaoTributariaRtc,
    ]),
  );
}

/**
 * Peneira e valida os padrões de um modelo antes de gravar.
 *
 * Devolve o objeto pronto para o jsonb e a lista de problemas. Com problemas,
 * quem chama não grava nada: meio padrão salvo é pior que padrão nenhum, porque
 * a emissão passaria a preencher item com combinação que a SEFAZ recusa.
 */
export async function prepararPadroesFiscais(
  entrada: unknown,
  crt: CRT | number | null,
): Promise<{ padroes: PadroesPorOperacao; issues: PadraoFiscalIssueLocalizada[] }> {
  const bruto =
    entrada && typeof entrada === "object" && !Array.isArray(entrada)
      ? (entrada as Record<string, unknown>)
      : {};

  const padroes: PadroesPorOperacao = {};
  for (const operacao of OPERACOES_PADRAO) {
    if (!(operacao in bruto)) continue;
    padroes[operacao] = normalizarPadraoFiscalItem(bruto[operacao]);
  }

  const codigos = Array.from(
    new Set(
      OPERACOES_PADRAO.map((operacao) => padroes[operacao]?.cclass_trib)
        .map((codigo) => String(codigo ?? "").replace(/\D/g, ""))
        .filter(Boolean),
    ),
  );
  const classificacoes = await carregarClassificacoesVigentes(codigos);

  const issues: PadraoFiscalIssueLocalizada[] = [];
  for (const operacao of OPERACOES_PADRAO) {
    const padrao = padroes[operacao];
    if (!padrao || Object.keys(padrao).length === 0) continue;
    for (const issue of validarPadraoFiscalItem({ padrao, crt, classificacoes })) {
      issues.push({ ...issue, operacao });
    }
  }

  return { padroes, issues };
}

/** Mensagem única para a tela, já dizendo em qual operação está o problema. */
export function descreverIssues(issues: PadraoFiscalIssueLocalizada[]): string {
  return issues
    .map(
      (issue) =>
        `${issue.operacao === "ENTRADA" ? "Entrada" : "Saída"} · ${issue.mensagem}`,
    )
    .join(" ");
}
