export type VersaoLeiauteNFSe = "NT004_NT007" | "NT009_RELEASE1";
export type BemMovelNFSe = { codigo_ncm: string; descricao: string; quantidade: number };

/**
 * Liberação oficial + suporte efetivo Focus, congelados em 31/10/2026.
 * A previsão de dezembro não promove o leiaute automaticamente em produção.
 * https://campos.focusnfe.com.br/nfse_nacional_homologacao/EmissaoDPSXml.html
 */
export function resolverLeiauteNFSe(ambiente: string, solicitada?: VersaoLeiauteNFSe): VersaoLeiauteNFSe {
  const vigente = ambiente === "PRODUCAO" ? "NT004_NT007" : "NT009_RELEASE1";
  if (ambiente === "PRODUCAO" && solicitada === "NT009_RELEASE1") {
    throw new Error("A NT 009 ainda não está liberada neste emissor em produção. Utilize a NT 004/007.");
  }
  return solicitada ?? vigente;
}

export function pendenciaLeiauteNFSe(payload: Record<string, unknown>, versao: VersaoLeiauteNFSe): string | null {
  const codigo = String(payload.codigo_tributacao_nacional_iss ?? "").replace(/\D/g, "");
  if (versao !== "NT009_RELEASE1" && (/^990[234]/.test(codigo) || payload.bens_moveis !== undefined)) {
    return "Os fornecimentos 99.02 a 99.04 e bens móveis da NT 009 estão disponíveis somente em homologação.";
  }
  // Os novos grupos de pagamento não constam na tabela JSON Focus consultada.
  // Não converter tags XML em nomes JSON presumidos.
  if (["gPgtoVinc", "vAjusteBC", "pagamentos_vinculados"].some((campo) => payload[campo] !== undefined)) {
    return "Este grupo da NT 009 depende da confirmação do contrato JSON e da liberação pela Focus NFe.";
  }
  if (payload.bens_moveis !== undefined) {
    if (!Array.isArray(payload.bens_moveis) || !payload.bens_moveis.length || payload.bens_moveis.length > 1000) {
      return "Informe de 1 a 1.000 bens móveis na DPS.";
    }
    for (const bem of payload.bens_moveis) {
      if (!bem || typeof bem !== "object" || !/^\d{8}$/.test(String(bem.codigo_ncm ?? ""))
          || typeof bem.descricao !== "string" || bem.descricao.trim().length < 1 || bem.descricao.length > 150
          || !Number.isInteger(bem.quantidade) || bem.quantidade < 1 || bem.quantidade > 999) {
        return "Cada bem móvel precisa de NCM com 8 dígitos, descrição de até 150 caracteres e quantidade inteira de 1 a 999.";
      }
    }
  }
  return null;
}
