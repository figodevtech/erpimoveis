export const USOCONSUMO_ITEM_FIELDS = "id,escopo,titulo,descricao,referencia,fabricante,grupo_id,grupo:usoconsumo_grupo(id,nome),unidade,conservacao,codigobarras,etiqueta,local,estoque,estoqueminimo,status_estoque,precocompra,ultimovalordecompra,img_url,ncm,cest,cfop_entrada,origem_mercadoria,csosn,cst,aliquotaicms,cst_pis,aliquota_pis,modo_pis,aliquota_por_unidade_pis,cst_cofins,aliquota_cofins,modo_cofins,aliquota_por_unidade_cofins,cst_ibscbs,cclass_trib,aliquota_ibs_uf,aliquota_ibs_municipio,aliquota_cbs,ativo,created_at,updated_at";

/**
 * Campos da busca rápida de itens (`/api/usoconsumo/itens/select`). Além da
 * identificação, carrega o bloco tributário do cadastro: a NF-e avulsa monta o
 * item da nota a partir daqui e sem isso o operador redigitaria CSOSN, origem e
 * CST de PIS/COFINS à mão. `cfop_entrada` também atende ao lançamento manual;
 * consumidores de saída o ignoram e calculam o CFOP da própria operação.
 *
 * `local`, `etiqueta` e `img_url` entraram para o dialog de seleção poder
 * mostrar o mesmo tipo de identificação visual do seletor de produto.
 */
export const USOCONSUMO_ITEM_SELECT_FIELDS =
  "id,escopo,titulo,descricao,referencia,fabricante,codigobarras,unidade,estoque,precocompra,ultimovalordecompra,local,etiqueta,img_url,ncm,cest,cfop_entrada,origem_mercadoria,csosn,cst,aliquotaicms,cst_pis,aliquota_pis,modo_pis,aliquota_por_unidade_pis,cst_cofins,aliquota_cofins,modo_cofins,aliquota_por_unidade_cofins,cst_ibscbs,cclass_trib,aliquota_ibs_uf,aliquota_ibs_municipio,aliquota_cbs";
