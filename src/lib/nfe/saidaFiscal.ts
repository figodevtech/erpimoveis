export const OPERACOES_FISCAIS_SAIDA = {
  DEVOLUCAO_COMPRA_COMERCIALIZACAO: {
    codigo: "DEVOLUCAO_COMPRA_COMERCIALIZACAO",
    label: "Devolução de compra para comercialização",
    naturezaOperacao: "DEVOLUCAO DE COMPRA PARA COMERCIALIZACAO",
    finalidade: "DEVOLUCAO",
    cfopInterno: "5202",
    cfopInterestadual: "6202",
    exigeDocumentoReferenciado: true,
  },
  DEVOLUCAO_COMPRA_INDUSTRIALIZACAO: {
    codigo: "DEVOLUCAO_COMPRA_INDUSTRIALIZACAO",
    label: "Devolução de compra para industrialização",
    naturezaOperacao: "DEVOLUCAO DE COMPRA PARA INDUSTRIALIZACAO",
    finalidade: "DEVOLUCAO",
    cfopInterno: "5201",
    cfopInterestadual: "6201",
    exigeDocumentoReferenciado: true,
  },
  REMESSA_CONSERTO_REPARO: {
    codigo: "REMESSA_CONSERTO_REPARO",
    label: "Remessa para conserto ou reparo",
    naturezaOperacao: "REMESSA PARA CONSERTO OU REPARO",
    finalidade: "NORMAL",
    cfopInterno: "5915",
    cfopInterestadual: "6915",
    exigeDocumentoReferenciado: false,
  },
  RETORNO_CONSERTO_REPARO: {
    codigo: "RETORNO_CONSERTO_REPARO",
    label: "Retorno de mercadoria recebida para conserto ou reparo",
    naturezaOperacao: "RETORNO DE MERCADORIA RECEBIDA PARA CONSERTO OU REPARO",
    finalidade: "NORMAL",
    cfopInterno: "5916",
    cfopInterestadual: "6916",
    exigeDocumentoReferenciado: true,
  },
  REMESSA_GARANTIA: {
    codigo: "REMESSA_GARANTIA",
    label: "Remessa em garantia ou troca",
    naturezaOperacao: "REMESSA EM GARANTIA",
    finalidade: "NORMAL",
    // A classificação varia conforme a operação concreta. Mantemos vazio
    // para obrigar a revisão do item, em vez de transformar "garantia" em CFOP.
    cfopInterno: "",
    cfopInterestadual: "",
    exigeDocumentoReferenciado: true,
  },
  OUTRA: {
    codigo: "OUTRA",
    label: "Outra natureza fiscal",
    naturezaOperacao: "",
    finalidade: "NORMAL",
    cfopInterno: "",
    cfopInterestadual: "",
    exigeDocumentoReferenciado: false,
  },
} as const;

export type OperacaoFiscalSaidaCodigo = keyof typeof OPERACOES_FISCAIS_SAIDA;
export type FinalidadeFiscalSaida = "NORMAL" | "COMPLEMENTAR" | "AJUSTE" | "DEVOLUCAO";

export function getOperacaoFiscalSaida(codigo: unknown) {
  const key = String(codigo ?? "") as OperacaoFiscalSaidaCodigo;
  return OPERACOES_FISCAIS_SAIDA[key] ?? null;
}

export function sugerirCfopSaida(
  codigo: OperacaoFiscalSaidaCodigo,
  ufEmitente: unknown,
  ufDestinatario: unknown,
) {
  const operacao = getOperacaoFiscalSaida(codigo);
  if (!operacao) return "";
  const origem = String(ufEmitente ?? "").trim().toUpperCase();
  const destino = String(ufDestinatario ?? "").trim().toUpperCase();
  return origem && destino && origem !== destino
    ? operacao.cfopInterestadual
    : operacao.cfopInterno;
}

/**
 * Resolve o nItem citado na NF-e de saída.
 *
 * Quando a linha da entrada já conhece sua posição no documento recebido,
 * ela é a fonte canônica. O valor enviado pela tela existe apenas para entradas
 * antigas que ainda não puderam ser reconciliadas com o XML.
 */
export function normalizarNumeroItemReferenciado(
  numeroItemFiscal: unknown,
  numeroItemInformado: unknown,
) {
  const canonico = Number(numeroItemFiscal ?? 0);
  if (Number.isInteger(canonico) && canonico >= 1 && canonico <= 990) {
    return canonico;
  }

  const informado = Number(numeroItemInformado ?? 0);
  return Number.isInteger(informado) && informado >= 1 && informado <= 990
    ? informado
    : null;
}

/**
 * Documentos que a NF-e de saída deve citar no grupo `<NFref>` do `<ide>`.
 *
 * A regra VC02 cobra um documento referenciado em toda nota com `finNFe=4` —
 * sem nenhum, a SEFAZ devolve a rejeição 321. Mas o referenciamento tem de
 * acontecer em UM nível só: `<NFref>` no cabeçalho OU `<DFeReferenciado>` em
 * cada item. Informar os dois é a rejeição 1010.
 *
 * Por isso, quando os itens já citam a origem, o cabeçalho sai vazio: o nível
 * de item é o mais específico e é o exigido em devolução a partir de
 * 01/09/2026, então é ele que prevalece.
 *
 * Também devolve lista vazia quando a operação não exige referência ou quando a
 * chave ainda não está completa; quem cobra a chave faltante é
 * `validarReferenciaFiscalSaida`.
 */
export function montarReferenciasFiscaisSaida(input: {
  finalidade: FinalidadeFiscalSaida;
  exigeDocumentoReferenciado: boolean;
  chaveAcesso?: unknown;
  /** Algum item já cita o documento de origem no `DFeReferenciado`. */
  temReferenciaPorItem?: boolean;
}): Array<{ chaveAcesso: string }> {
  if (input.temReferenciaPorItem) return [];
  const exige = input.exigeDocumentoReferenciado || input.finalidade === "DEVOLUCAO";
  if (!exige) return [];
  const chave = String(input.chaveAcesso ?? "").replace(/\D/g, "");
  return chave.length === 44 ? [{ chaveAcesso: chave }] : [];
}

export function validarReferenciaFiscalSaida(input: {
  finalidade: FinalidadeFiscalSaida;
  exigeDocumentoReferenciado: boolean;
  chaveAcesso?: unknown;
  itens: Array<{ numeroItemReferenciado?: unknown }>;
}) {
  const errors: string[] = [];
  const chave = String(input.chaveAcesso ?? "").replace(/\D/g, "");
  const exige = input.exigeDocumentoReferenciado || input.finalidade === "DEVOLUCAO";
  if (exige && chave.length !== 44) {
    errors.push("Informe a chave de acesso com 44 dígitos do documento fiscal de origem.");
  }
  if (exige) {
    input.itens.forEach((item, index) => {
      const numero = Number(item.numeroItemReferenciado ?? 0);
      if (!Number.isInteger(numero) || numero <= 0 || numero > 990) {
        errors.push(`Informe o número do item no documento fiscal de origem para a linha ${index + 1}.`);
      }
    });
  }
  return errors;
}
