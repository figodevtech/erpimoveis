export function motivoBloqueioTransmissao(status: string | null): string | null {
  if (["AUTORIZADA", "CANCELADA", "DENEGADA"].includes(status ?? "")) {
    return "Documento fiscal já possui desfecho registrado. Consulte a situação da chave; o XML histórico não pode ser retransmitido por esta ação.";
  }
  if (["RESULTADO_INCERTO", "ENVIADA"].includes(status ?? "")) {
    return "Consulte a situação da chave antes de tentar transmitir novamente: a SEFAZ pode já ter autorizado o documento.";
  }
  return null;
}

/** Não libera numeração quando a resposta não comprova o desfecho da transmissão. */
export function classificarRetornoAutorizacao(params: {
  lote: string | null;
  protocolo: string | null;
  numeroProtocolo: string | null;
  chaveProtocolo: string | null;
  chaveEnviada: string | null;
}): "AUTORIZADA" | "DENEGADA" | "REJEITADA" | "ENVIADA" | "RESULTADO_INCERTO" {
  if (params.protocolo === "100") {
    return params.numeroProtocolo && params.chaveEnviada && params.chaveProtocolo === params.chaveEnviada
      ? "AUTORIZADA" : "RESULTADO_INCERTO";
  }
  // A duplicidade prova que a chave já existe; consultar antes de declarar rejeição.
  if (params.protocolo === "204" || params.lote === "204") return "RESULTADO_INCERTO";
  if (["110", "301", "302"].includes(params.protocolo ?? "")) return "DENEGADA";
  if (params.protocolo) return "REJEITADA";
  if (params.lote === "103") return "ENVIADA";
  // Lote processado sem protocolo, HTTP inesperado e resposta ilegível não são autorização.
  return "RESULTADO_INCERTO";
}
