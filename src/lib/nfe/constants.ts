export const NFE_HOMOLOGACAO_DESTINATARIO_NOME =
  "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

/**
 * Homologação da NFC-e não marca o destinatário — que pode nem existir — e sim
 * a descrição do primeiro item. É regra de validação do MOC: sem ela a SEFAZ
 * rejeita o documento de teste.
 */
export const NFCE_HOMOLOGACAO_PRIMEIRO_ITEM_DESCRICAO =
  "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
