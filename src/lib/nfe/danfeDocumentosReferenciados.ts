import type { DanfeDocumentoReferenciado } from "./danfeParser";

export function formatarChaveDanfe(chave: string): string {
  return chave.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function descreverDocumentoReferenciado(documento: DanfeDocumentoReferenciado): string {
  const rotulos: Record<DanfeDocumentoReferenciado["tipo"], string> = {
    NFE: "NF-e", NF_MODELO_1: "NF modelo 1", NFP: "NFP",
    CTE: "CT-e", ECF: "ECF", DESCONHECIDO: documento.subtipo || "Documento",
  };
  const detalhes = documento.chave
    ? formatarChaveDanfe(documento.chave)
    : Object.entries(documento.campos ?? {}).filter(([, valor]) => valor).map(([campo, valor]) => `${campo}: ${valor}`).join(" · ");
  return detalhes ? `${rotulos[documento.tipo]}: ${detalhes}` : "";
}
