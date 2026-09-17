import type { EfdRecord, SpedDiagnostic } from "@/lib/sped/efd-icms-ipi";

type Row = Record<string, any>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectSpedInventory(input: {
  applicable: boolean;
  inventory: Row | null;
  items: Row[];
  competenceEnd: string;
}) {
  const records: EfdRecord[] = [];
  const catalogRecords: EfdRecord[] = [];
  const diagnostics: SpedDiagnostic[] = [];
  if (!input.applicable) return { records, catalogRecords, diagnostics };
  if (!input.inventory) {
    diagnostics.push({
      code: "INVENTARIO_APROVADO_AUSENTE",
      severity: "BLOQUEIO",
      message: "O Bloco H foi confirmado como aplicável, mas não há fechamento de inventário aprovado selecionado.",
      record: "H005",
      source: { source: "CONFIGURACAO", table: "fiscal_sped_config" },
    });
    return { records, catalogRecords, diagnostics };
  }
  const inventoryDate = text(input.inventory.data_inventario).slice(0, 10);
  const reason = text(input.inventory.motivo);
  if (inventoryDate > input.competenceEnd) diagnostics.push({
    code: "INVENTARIO_DATA_FUTURA",
    severity: "BLOQUEIO",
    message: `O inventário selecionado (${inventoryDate}) é posterior ao fim da competência.`,
    record: "H005",
    source: { source: "BANCO", table: "fiscal_inventario_fechamento", id: input.inventory.id },
  });
  if (!/^0[1-6]$/.test(reason)) diagnostics.push({
    code: "INVENTARIO_MOTIVO_INVALIDO",
    severity: "BLOQUEIO",
    message: "O motivo do inventário deve ser um código H005 válido entre 01 e 06.",
    record: "H005",
    field: "MOT_INV",
    source: { source: "BANCO", table: "fiscal_inventario_fechamento", id: input.inventory.id },
  });
  if (input.items.length === 0) diagnostics.push({
    code: "INVENTARIO_SEM_ITENS",
    severity: "BLOQUEIO",
    message: "O fechamento de inventário aprovado não possui itens.",
    record: "H010",
    source: { source: "BANCO", table: "fiscal_inventario_fechamento", id: input.inventory.id },
  });
  records.push({
    code: "H005",
    values: {
      DT_INV: inventoryDate,
      VL_INV: input.items.reduce((sum, item) => sum + number(item.valor_total), 0),
      MOT_INV: reason,
    },
    source: { source: "BANCO", table: "fiscal_inventario_fechamento", id: input.inventory.id },
  });

  const propertyCodes: Record<string, string> = {
    PROPRIO: "0",
    PROPRIO_EM_TERCEIRO: "1",
    TERCEIRO_EM_POSSE: "2",
  };
  for (const item of input.items) {
    const source = { source: "BANCO" as const, table: "fiscal_inventario_item", id: item.id };
    const participantCode = text(item.participante_codigo) || null;
    const property = propertyCodes[text(item.indicador_propriedade)];
    if (!property) diagnostics.push({
      code: "INVENTARIO_PROPRIEDADE_INVALIDA",
      severity: "BLOQUEIO",
      message: `O item ${item.codigo_item} possui indicador de propriedade inválido.`,
      record: "H010",
      field: "IND_PROP",
      source,
    });
    if (property && property !== "0" && !participantCode) diagnostics.push({
      code: "INVENTARIO_PARTICIPANTE_AUSENTE",
      severity: "BLOQUEIO",
      message: `O item ${item.codigo_item} exige participante por não estar em posse e propriedade simultâneas do declarante.`,
      record: "H010",
      field: "COD_PART",
      source,
    });
    records.push({
      code: "H010",
      values: {
        COD_ITEM: text(item.codigo_item),
        UNID: text(item.unidade),
        QTD: number(item.quantidade),
        VL_UNIT: number(item.valor_unitario),
        VL_ITEM: number(item.valor_total),
        IND_PROP: property,
        COD_PART: participantCode,
        TXT_COMPL: text(item.payload?.descricaoComplementar),
        COD_CTA: text(item.payload?.codigoConta),
        VL_ITEM_IR: item.payload?.valorImpostoRenda == null ? null : number(item.payload.valorImpostoRenda),
      },
      source,
    });
    const hasH020 = item.cst_icms != null || item.base_icms != null || item.valor_icms != null;
    if (hasH020) {
      if (!/^\d{3}$/.test(text(item.cst_icms)) || item.base_icms == null || item.valor_icms == null) diagnostics.push({
        code: "INVENTARIO_H020_INCOMPLETO",
        severity: "BLOQUEIO",
        message: `O item ${item.codigo_item} possui dados incompletos para o H020.`,
        record: "H020",
        source,
      });
      records.push({
        code: "H020",
        values: { CST_ICMS: text(item.cst_icms), BC_ICMS: number(item.base_icms), VL_ICMS: number(item.valor_icms) },
        source,
      });
    }
    catalogRecords.push(
      { code: "0190", values: { UNID: text(item.unidade), DESCR: text(item.unidade) }, source },
      {
        code: "0200",
        values: {
          COD_ITEM: text(item.codigo_item),
          DESCR_ITEM: text(item.payload?.descricao) || text(item.codigo_item),
          UNID_INV: text(item.unidade),
          TIPO_ITEM: text(item.config?.tipo_item) || text(item.payload?.tipoItem) || "99",
          COD_NCM: text(item.payload?.ncm),
          CEST: text(item.payload?.cest),
        },
        source,
      },
    );
    if (participantCode) {
      const participantName = text(item.payload?.participanteNome);
      if (!participantName) diagnostics.push({
        code: "INVENTARIO_PARTICIPANTE_CADASTRO_INCOMPLETO",
        severity: "BLOQUEIO",
        message: `O participante ${participantCode} do inventário não possui nome histórico para o 0150.`,
        record: "0150",
        source,
      });
      catalogRecords.push({
        code: "0150",
        values: {
          COD_PART: participantCode,
          NOME: participantName,
          COD_PAIS: text(item.payload?.codigoPais) || "01058",
          CNPJ: item.participante_documento_tipo === "CNPJ" ? item.participante_documento_canonico : null,
          CPF: item.participante_documento_tipo === "CPF" ? item.participante_documento_canonico : null,
          IE: text(item.payload?.inscricaoEstadual),
          COD_MUN: text(item.payload?.codigoMunicipio),
        },
        source,
      });
    }
  }
  return { records, catalogRecords, diagnostics };
}
