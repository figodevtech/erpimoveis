/**
 * Nem todo modelo de emissao de NFS-e entrega o PDF da nota.
 *
 * Joao Pessoa expoe um endpoint que devolve o proprio documento, entao da para
 * baixar e anexar. Cabedelo e a NFS-e Nacional (MEI) devolvem apenas um link de
 * consulta — uma pagina do portal, nao um arquivo — e por isso nao ha o que
 * anexar automaticamente nesses casos.
 *
 * `MUNICIPAL` e o valor legado das notas emitidas antes de o modelo ser
 * desmembrado por municipio; na pratica sao notas de Joao Pessoa.
 */
export const NFSE_MODELOS_COM_PDF = ["MUNICIPAL", "MUNICIPAL_JOAO_PESSOA"] as const;

export function nfseEntregaPdf(modeloEmissao?: string | null) {
  const modelo = String(modeloEmissao ?? "").trim().toUpperCase();
  return (NFSE_MODELOS_COM_PDF as readonly string[]).includes(modelo);
}

export function nfseMotivoSemPdf(modeloEmissao?: string | null) {
  const modelo = String(modeloEmissao ?? "").trim().toUpperCase();

  if (modelo === "MUNICIPAL_CABEDELO") {
    return "A prefeitura de Cabedelo disponibiliza apenas um link de consulta da NFS-e, não o PDF do documento.";
  }
  if (modelo === "NACIONAL") {
    return "A NFS-e Nacional (MEI) disponibiliza apenas o link de consulta no portal nacional, não o PDF do documento.";
  }
  return "Este modelo de emissão não disponibiliza o PDF da NFS-e para download.";
}
