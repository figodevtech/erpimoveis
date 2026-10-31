import type { AutorizadorNFSe } from "./nfse-politica";

/** Só os campos necessários do cadastro Focus; tokens e certificados nunca saem desta consulta. */
export type ConfiguracaoDestinoFocus = {
  habilita_nfse?: boolean;
  habilita_nfsen_producao?: boolean;
  habilita_nfsen_homologacao?: boolean;
};

// A família /v2/nfsen não distingue Sefin de autorizador municipal (ex.: DSF).
// Campos: https://doc.focusnfe.com.br/reference/consultar_empresa_por_id
// João Pessoa: https://focusnfe.com.br/guides/nfse/municipios-integrados/joao-pessoa-pb/
export function pendenciaDestinoFocus(
  configuracao: ConfiguracaoDestinoFocus,
  autorizador: AutorizadorNFSe,
  ambiente: "PRODUCAO" | "HOMOLOGACAO",
): string | null {
  const nacional = ambiente === "PRODUCAO"
    ? configuracao.habilita_nfsen_producao : configuracao.habilita_nfsen_homologacao;
  if (autorizador === "FOCUS_NACIONAL" && nacional !== true) {
    return `Habilite o Ambiente da NFS-e Nacional em ${ambiente} no cadastro da empresa na Focus antes de emitir pelo Emissor Público Nacional.`;
  }
  if (autorizador === "FOCUS_FORMATO_NACIONAL_MUNICIPAL"
      && (configuracao.habilita_nfse !== true || nacional !== false)) {
    return `O autorizador municipal no formato nacional exige NFS-e padrão ativa e Ambiente da NFS-e Nacional desabilitado em ${ambiente} na Focus. Confira o cadastro antes de emitir.`;
  }
  return null;
}
