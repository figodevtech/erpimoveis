import type {
  EfdFieldDefinition,
  EfdLayout,
  EfdRecordDefinition,
} from "../../types";

const text = (name: string, required = false, maxLength?: number): EfdFieldDefinition => ({
  name,
  type: "text",
  required,
  maxLength,
});
const integer = (name: string, required = false): EfdFieldDefinition => ({
  name,
  type: "integer",
  required,
});
const decimal = (name: string, scale = 2, required = false): EfdFieldDefinition => ({
  name,
  type: "decimal",
  required,
  scale,
});
const date = (name: string, required = false): EfdFieldDefinition => ({
  name,
  type: "date",
  required,
});

const definitions: EfdRecordDefinition[] = [
  { code: "0000", block: "0", fields: [text("COD_VER", true), text("COD_FIN", true), date("DT_INI", true), date("DT_FIN", true), text("NOME", true), text("CNPJ"), text("CPF"), text("UF", true), text("IE", true), text("COD_MUN", true), text("IM"), text("SUFRAMA"), text("IND_PERFIL", true), text("IND_ATIV", true)] },
  { code: "0001", block: "0", fields: [text("IND_MOV", true)] },
  { code: "0005", block: "0", fields: [text("FANTASIA", true), text("CEP", true), text("END", true), text("NUM", true), text("COMPL"), text("BAIRRO", true), text("FONE"), text("FAX"), text("EMAIL")] },
  { code: "0100", block: "0", fields: [text("NOME", true), text("CPF", true), text("CRC", true), text("CNPJ"), text("CEP", true), text("END", true), text("NUM", true), text("COMPL"), text("BAIRRO", true), text("FONE"), text("FAX"), text("EMAIL", true), text("COD_MUN", true)] },
  { code: "0150", block: "0", fields: [text("COD_PART", true), text("NOME", true), text("COD_PAIS", true), text("CNPJ"), text("CPF"), text("IE"), text("COD_MUN"), text("SUFRAMA"), text("END"), text("NUM"), text("COMPL"), text("BAIRRO")] },
  { code: "0190", block: "0", fields: [text("UNID", true), text("DESCR", true)] },
  { code: "0200", block: "0", fields: [text("COD_ITEM", true), text("DESCR_ITEM", true), text("COD_BARRA"), text("COD_ANT_ITEM"), text("UNID_INV", true), text("TIPO_ITEM", true), text("COD_NCM"), text("EX_IPI"), text("COD_GEN"), text("COD_LST"), decimal("ALIQ_ICMS"), text("CEST")] },
  { code: "0205", block: "0", fields: [text("DESCR_ANT_ITEM", true), date("DT_INI", true), date("DT_FIM", true), text("COD_ANT_ITEM")] },
  { code: "0220", block: "0", fields: [text("UNID_CONV", true), decimal("FAT_CONV", 6, true), text("COD_BARRA")] },
  { code: "0221", block: "0", fields: [text("COD_ITEM_ATOMICO", true), decimal("QTD_CONTIDA", 6, true)] },
  { code: "0450", block: "0", fields: [text("COD_INF", true), text("TXT_COMPL", true)] },
  { code: "0990", block: "0", fields: [integer("QTD_LIN_0", true)] },

  { code: "B001", block: "B", fields: [text("IND_DAD", true)] },
  { code: "B990", block: "B", fields: [integer("QTD_LIN_B", true)] },
  { code: "C001", block: "C", fields: [text("IND_MOV", true)] },
  { code: "C100", block: "C", fields: [text("IND_OPER", true), text("IND_EMIT", true), text("COD_PART"), text("COD_MOD", true), text("COD_SIT", true), text("SER"), text("NUM_DOC"), text("CHV_NFE"), date("DT_DOC"), date("DT_E_S"), decimal("VL_DOC"), text("IND_PGTO"), decimal("VL_DESC"), decimal("VL_ABAT_NT"), decimal("VL_MERC"), text("IND_FRT"), decimal("VL_FRT"), decimal("VL_SEG"), decimal("VL_OUT_DA"), decimal("VL_BC_ICMS"), decimal("VL_ICMS"), decimal("VL_BC_ICMS_ST"), decimal("VL_ICMS_ST"), decimal("VL_IPI"), decimal("VL_PIS"), decimal("VL_COFINS"), decimal("VL_PIS_ST"), decimal("VL_COFINS_ST")] },
  { code: "C101", block: "C", fields: [decimal("VL_FCP_UF_DEST", 2, true), decimal("VL_ICMS_UF_DEST", 2, true), decimal("VL_ICMS_UF_REM", 2, true)] },
  { code: "C110", block: "C", fields: [text("COD_INF", true), text("TXT_COMPL")] },
  { code: "C113", block: "C", fields: [text("IND_OPER", true), text("IND_EMIT", true), text("COD_PART"), text("COD_MOD", true), text("SER"), text("SUB"), text("NUM_DOC", true), date("DT_DOC"), text("CHV_DOC_ELE")] },
  { code: "C170", block: "C", fields: [integer("NUM_ITEM", true), text("COD_ITEM", true), text("DESCR_COMPL"), decimal("QTD", 3, true), text("UNID", true), decimal("VL_ITEM", 2, true), decimal("VL_DESC"), text("IND_MOV", true), text("CST_ICMS", true), text("CFOP", true), text("COD_NAT"), decimal("VL_BC_ICMS"), decimal("ALIQ_ICMS"), decimal("VL_ICMS"), decimal("VL_BC_ICMS_ST"), decimal("ALIQ_ST"), decimal("VL_ICMS_ST"), text("IND_APUR"), text("CST_IPI"), text("COD_ENQ"), decimal("VL_BC_IPI"), decimal("ALIQ_IPI"), decimal("VL_IPI"), text("CST_PIS"), decimal("VL_BC_PIS"), decimal("ALIQ_PIS_QUANT", 4), decimal("QUANT_BC_PIS", 3), decimal("ALIQ_PIS", 4), decimal("VL_PIS"), text("CST_COFINS"), decimal("VL_BC_COFINS"), decimal("ALIQ_COFINS_QUANT", 4), decimal("QUANT_BC_COFINS", 3), decimal("ALIQ_COFINS", 4), decimal("VL_COFINS"), text("COD_CTA"), decimal("VL_ABAT_NT")] },
  { code: "C176", block: "C", fields: [text("COD_MOD_ULT_E", true), text("NUM_DOC_ULT_E", true), text("SER_ULT_E", true), date("DT_ULT_E", true), text("COD_PART_ULT_E", true), decimal("QUANT_ULT_E", 3, true), decimal("VL_UNIT_ULT_E", 6, true), decimal("VL_UNIT_BC_ST", 6), text("CHAVE_NFE_ULT_E"), integer("NUM_ITEM_ULT_E"), decimal("VL_UNIT_BC_ICMS_ULT_E", 6), decimal("ALIQ_ICMS_ULT_E"), decimal("VL_UNIT_LIMITE_BC_ICMS_ULT_E", 6), decimal("VL_UNIT_ICMS_ULT_E", 6), decimal("ALIQ_ST_ULT_E"), decimal("VL_UNIT_RES", 6), text("COD_RESP_RET"), text("COD_MOT_RES"), text("CHAVE_NFE_RET"), text("COD_PART_NFE_RET"), text("SER_NFE_RET"), text("NUM_NFE_RET"), integer("ITEM_NFE_RET"), text("COD_DA"), text("NUM_DA")] },
  { code: "C179", block: "C", fields: [decimal("BC_ST_ORIG_DEST", 2, true), decimal("ICMS_ST_REP", 2, true), decimal("ICMS_ST_COMPL", 2, true), decimal("BC_RET", 2, true), decimal("ICMS_RET", 2, true)] },
  { code: "C190", block: "C", fields: [text("CST_ICMS", true), text("CFOP", true), decimal("ALIQ_ICMS", 2, true), decimal("VL_OPR", 2, true), decimal("VL_BC_ICMS"), decimal("VL_ICMS"), decimal("VL_BC_ICMS_ST"), decimal("VL_ICMS_ST"), decimal("VL_RED_BC"), decimal("VL_IPI"), text("COD_OBS")] },
  { code: "C191", block: "C", fields: [decimal("VL_FCP_OP"), decimal("VL_FCP_ST"), decimal("VL_FCP_RET")] },
  { code: "C195", block: "C", fields: [text("COD_OBS", true), text("TXT_COMPL")] },
  { code: "C197", block: "C", fields: [text("COD_AJ", true), text("DESCR_COMPL_AJ"), text("COD_ITEM"), decimal("VL_BC_ICMS"), decimal("ALIQ_ICMS"), decimal("VL_ICMS"), decimal("VL_OUTROS")] },
  { code: "C990", block: "C", fields: [integer("QTD_LIN_C", true)] },
  { code: "D001", block: "D", fields: [text("IND_MOV", true)] },
  { code: "D990", block: "D", fields: [integer("QTD_LIN_D", true)] },

  { code: "E001", block: "E", fields: [text("IND_MOV", true)] },
  { code: "E100", block: "E", fields: [date("DT_INI", true), date("DT_FIN", true)] },
  { code: "E110", block: "E", fields: [decimal("VL_TOT_DEBITOS", 2, true), decimal("VL_AJ_DEBITOS", 2, true), decimal("VL_TOT_AJ_DEBITOS", 2, true), decimal("VL_ESTORNOS_CRED", 2, true), decimal("VL_TOT_CREDITOS", 2, true), decimal("VL_AJ_CREDITOS", 2, true), decimal("VL_TOT_AJ_CREDITOS", 2, true), decimal("VL_ESTORNOS_DEB", 2, true), decimal("VL_SLD_CREDOR_ANT", 2, true), decimal("VL_SLD_APURADO", 2, true), decimal("VL_TOT_DED", 2, true), decimal("VL_ICMS_RECOLHER", 2, true), decimal("VL_SLD_CREDOR_TRANSPORTAR", 2, true), decimal("DEB_ESP", 2, true)] },
  { code: "E111", block: "E", fields: [text("COD_AJ_APUR", true), text("DESCR_COMPL_AJ"), decimal("VL_AJ_APUR", 2, true)] },
  { code: "E112", block: "E", fields: [text("NUM_DA", true), text("NUM_PROC"), text("IND_PROC"), text("PROC"), text("TXT_COMPL")] },
  { code: "E113", block: "E", fields: [text("COD_PART"), text("COD_MOD", true), text("SER"), text("SUB"), text("NUM_DOC", true), date("DT_DOC"), text("COD_ITEM"), decimal("VL_AJ_ITEM", 2, true), text("CHV_DOC_ELE")] },
  { code: "E115", block: "E", fields: [text("COD_INF_ADIC", true), decimal("VL_INF_ADIC", 2, true), text("DESCR_COMPL_AJ")] },
  { code: "E116", block: "E", fields: [text("COD_OR", true), decimal("VL_OR", 2, true), date("DT_VCTO", true), text("COD_REC"), text("NUM_PROC"), text("IND_PROC"), text("PROC"), text("TXT_COMPL"), text("MES_REF")] },
  { code: "E300", block: "E", fields: [text("UF", true)] },
  { code: "E310", block: "E", fields: [text("IND_MOV_FCP_DIFAL", true), decimal("VL_SLD_CRED_ANT_DIFAL", 2, true), decimal("VL_TOT_DEBITOS_DIFAL", 2, true), decimal("VL_OUT_DEB_DIFAL", 2, true), decimal("VL_TOT_CREDITOS_DIFAL", 2, true), decimal("VL_OUT_CRED_DIFAL", 2, true), decimal("VL_SLD_DEV_ANT_DIFAL", 2, true), decimal("VL_DEDUCOES_DIFAL", 2, true), decimal("VL_RECOL_DIFAL", 2, true), decimal("VL_SLD_CRED_TRANSPORTAR_DIFAL", 2, true), decimal("DEB_ESP_DIFAL", 2, true), decimal("VL_SLD_CRED_ANT_FCP", 2, true), decimal("VL_TOT_DEB_FCP", 2, true), decimal("VL_OUT_DEB_FCP", 2, true), decimal("VL_TOT_CRED_FCP", 2, true), decimal("VL_OUT_CRED_FCP", 2, true), decimal("VL_SLD_DEV_ANT_FCP", 2, true), decimal("VL_DEDUCOES_FCP", 2, true), decimal("VL_RECOL_FCP", 2, true), decimal("VL_SLD_CRED_TRANSPORTAR_FCP", 2, true), decimal("DEB_ESP_FCP", 2, true)] },
  { code: "E311", block: "E", fields: [text("COD_AJ_APUR", true), text("DESCR_COMPL_AJ"), decimal("VL_AJ_APUR", 2, true)] },
  { code: "E312", block: "E", fields: [text("NUM_DA", true), text("NUM_PROC"), text("IND_PROC"), text("PROC"), text("TXT_COMPL")] },
  { code: "E313", block: "E", fields: [text("COD_PART"), text("COD_MOD", true), text("SER"), text("SUB"), text("NUM_DOC", true), text("CHV_DOC_ELE"), date("DT_DOC"), text("COD_ITEM"), decimal("VL_AJ_ITEM", 2, true)] },
  { code: "E316", block: "E", fields: [text("COD_OR", true), decimal("VL_OR", 2, true), date("DT_VCTO", true), text("COD_REC"), text("NUM_PROC"), text("IND_PROC"), text("PROC"), text("TXT_COMPL"), text("MES_REF")] },
  { code: "E990", block: "E", fields: [integer("QTD_LIN_E", true)] },

  { code: "G001", block: "G", fields: [text("IND_MOV", true)] },
  { code: "G990", block: "G", fields: [integer("QTD_LIN_G", true)] },
  { code: "H001", block: "H", fields: [text("IND_MOV", true)] },
  { code: "H005", block: "H", fields: [date("DT_INV", true), decimal("VL_INV", 2, true), text("MOT_INV", true)] },
  { code: "H010", block: "H", fields: [text("COD_ITEM", true), text("UNID", true), decimal("QTD", 3, true), decimal("VL_UNIT", 6, true), decimal("VL_ITEM", 2, true), text("IND_PROP", true), text("COD_PART"), text("TXT_COMPL"), text("COD_CTA"), decimal("VL_ITEM_IR")] },
  { code: "H020", block: "H", fields: [text("CST_ICMS", true), decimal("BC_ICMS", 2, true), decimal("VL_ICMS", 2, true)] },
  { code: "H990", block: "H", fields: [integer("QTD_LIN_H", true)] },
  { code: "K001", block: "K", fields: [text("IND_MOV", true)] },
  { code: "K990", block: "K", fields: [integer("QTD_LIN_K", true)] },

  { code: "1001", block: "1", fields: [text("IND_MOV", true)] },
  {
    code: "1010",
    block: "1",
    fields: [
      text("IND_EXP", true, 1),
      text("IND_CCRF", true, 1),
      text("IND_COMB", true, 1),
      text("IND_USINA", true, 1),
      text("IND_VA", true, 1),
      text("IND_EE", true, 1),
      text("IND_CART", true, 1),
      text("IND_FORM", true, 1),
      text("IND_AER", true, 1),
      text("IND_GIAF1", true, 1),
      text("IND_GIAF3", true, 1),
      text("IND_GIAF4", true, 1),
      text("IND_REST_RESSARC_COMPL_ICMS", true, 1),
    ],
  },
  { code: "1400", block: "1", fields: [text("COD_ITEM_IPM", true), text("MUN", true), decimal("VALOR", 2, true)] },
  { code: "1601", block: "1", fields: [text("COD_PART_IP", true), text("COD_PART_IT"), decimal("TOT_VS", 2, true), decimal("TOT_ISS", 2, true), decimal("TOT_OUTROS", 2, true)] },
  { code: "1990", block: "1", fields: [integer("QTD_LIN_1", true)] },

  { code: "9001", block: "9", fields: [text("IND_MOV", true)] },
  { code: "9900", block: "9", fields: [text("REG_BLC", true), integer("QTD_REG_BLC", true)] },
  { code: "9990", block: "9", fields: [integer("QTD_LIN_9", true)] },
  { code: "9999", block: "9", fields: [integer("QTD_LIN", true)] },
];

export const EFD_ICMS_IPI_LAYOUT_V020: EfdLayout = {
  code: "020",
  validFrom: "2026-01-01",
  validUntil: "2026-12-31",
  records: new Map(definitions.map((definition) => [definition.code, definition])),
};
