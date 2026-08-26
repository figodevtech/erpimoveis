export const USOCONSUMO_ITEM_FIELDS = "id,escopo,titulo,descricao,referencia,fabricante,grupo_id,grupo:usoconsumo_grupo(id,nome),unidade,conservacao,codigobarras,etiqueta,local,estoque,estoqueminimo,status_estoque,precocompra,ultimovalordecompra,img_url,ncm,cest,cfop_entrada,origem_mercadoria,csosn,cst,aliquotaicms,cst_pis,aliquota_pis,modo_pis,aliquota_por_unidade_pis,cst_cofins,aliquota_cofins,modo_cofins,aliquota_por_unidade_cofins,cst_ibscbs,cclass_trib,aliquota_ibs_uf,aliquota_ibs_municipio,aliquota_cbs,ativo,created_at,updated_at";

/**
 * Campos da busca rápida de itens (`/api/usoconsumo/itens/select`). Além da
 * identificação, carrega o bloco tributário do cadastro: a NF-e avulsa monta o
 * item da nota a partir daqui e sem isso o operador redigitaria CSOSN, origem e
 * CST de PIS/COFINS à mão. `cfop_entrada` fica de fora de propósito — é CFOP de
 * entrada (1556/2556) e não pode vazar para uma nota de saída.
 */
export const USOCONSUMO_ITEM_SELECT_FIELDS =
  "id,escopo,titulo,descricao,referencia,fabricante,codigobarras,unidade,estoque,precocompra,ultimovalordecompra,ncm,cest,origem_mercadoria,csosn,cst,aliquotaicms,cst_pis,aliquota_pis,modo_pis,aliquota_por_unidade_pis,cst_cofins,aliquota_cofins,modo_cofins,aliquota_por_unidade_cofins,cst_ibscbs,cclass_trib,aliquota_ibs_uf,aliquota_ibs_municipio,aliquota_cbs";
