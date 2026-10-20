import { endOfCompetence, parseCompetence } from "@/lib/fiscal-date";
import { inventarioAplicavelNaCompetencia } from "@/lib/sped/configuracao-empresa";
import { resolveSpedLayout, type EfdRecord, type SpedDiagnostic, type SpedGateStatus } from "@/lib/sped/efd-icms-ipi";
import { resolve1010Indicators } from "./indicators1010";

type Company = Record<string, unknown>;
type Config = Record<string, unknown> | null;
type Accountant = Record<string, unknown> | null;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function digits(value: unknown): string {
  return text(value).replace(/\D/g, "");
}

function status(config: Config, key: string): SpedGateStatus {
  const value = text(config?.[key]);
  return value === "CONFIRMADO" || value === "NAO_APLICAVEL" ? value : "PENDENTE";
}

export function buildGateConfiguration(config: Config, competence?: string) {
  const inventoryStatus = status(config, "inventario_status");
  return {
    profile: status(config, "perfil_efd_status"),
    blockK: status(config, "bloco_k_status"),
    blockKRequired:
      typeof config?.bloco_k_obrigatorio === "boolean" ? config.bloco_k_obrigatorio : undefined,
    record1400: status(config, "registro_1400_status"),
    record1400Applicable:
      typeof config?.registro_1400_aplicavel === "boolean" ? config.registro_1400_aplicavel : undefined,
    recordsC176C179: status(config, "c176_c179_status"),
    recordsC176C179Applicable:
      typeof config?.c176_c179_aplicavel === "boolean" ? config.c176_c179_aplicavel : undefined,
    record1601: status(config, "registro_1601_status"),
    record1601Applicable:
      typeof config?.registro_1601_aplicavel === "boolean" ? config.registro_1601_aplicavel : undefined,
    inventory: inventoryStatus,
    // No modo automático, fevereiro exige o inventário de 31/12 mesmo com o valor guardado false.
    inventoryApplicable: competence && inventoryStatus !== "PENDENTE"
      ? inventarioAplicavelNaCompetencia(config, competence)
      : typeof config?.inventario_aplicavel === "boolean" ? config.inventario_aplicavel : undefined,
  };
}

function movement(opening: string, closing: string): EfdRecord[] {
  return [
    { code: opening, values: { IND_MOV: "1", IND_DAD: "1" } },
    { code: closing, values: {} },
  ];
}

/**
 * Projeção estrutural mínima. Documentos, apuração e registros condicionais só
 * entram por projetores próprios; enquanto faltarem, a coleta cria bloqueios.
 */
export function buildFoundationRecords(input: {
  competence: string;
  /** Código do leiaute da versão; sem ele, vale o leiaute vigente na competência. */
  layoutCode?: string;
  /** Uma versão retificadora substitui o arquivo já entregue (COD_FIN = 1). */
  finalidade?: "ORIGINAL" | "RETIFICADORA";
  company: Company;
  config: Config;
  accountant: Accountant;
  payments1601?: Array<Record<string, unknown>>;
  catalogRecords?: EfdRecord[];
  blockCRecords?: EfdRecord[];
  blockERecords?: EfdRecord[];
  blockHRecords?: EfdRecord[];
}): EfdRecord[] {
  const { start } = parseCompetence(input.competence);
  const end = endOfCompetence(input.competence);
  const company = input.company;
  const config = input.config;
  const accountant = input.accountant;
  const payments1601 = input.payments1601 ?? [];
  const blockCRecords = input.blockCRecords ?? [];
  const blockERecords = input.blockERecords ?? [];
  const blockHRecords = input.blockHRecords ?? [];

  const records: EfdRecord[] = [
    {
      code: "0000",
      values: {
        COD_VER: input.layoutCode ?? resolveSpedLayout(input.competence).code,
        COD_FIN: input.finalidade === "RETIFICADORA" ? "1" : "0",
        DT_INI: start,
        DT_FIN: end,
        NOME: text(company.razaosocial),
        CNPJ: text(company.cnpj),
        UF: text(company.uf).toUpperCase(),
        IE: text(company.inscricaoestadual),
        COD_MUN: digits(company.codigomunicipio),
        IM: text(company.inscricaomunicipal),
        IND_PERFIL: text(config?.perfil_efd),
        IND_ATIV: text(config?.indicador_atividade),
      },
      source: { source: "CONFIGURACAO", table: "empresa", id: text(company.id) },
    },
    { code: "0001", values: { IND_MOV: "0" } },
    {
      code: "0005",
      values: {
        FANTASIA: text(company.nomefantasia) || text(company.razaosocial),
        CEP: digits(company.cep),
        END: text(company.endereco),
        NUM: text(company.numero),
        COMPL: text(company.complemento),
        BAIRRO: text(company.bairro),
        FONE: digits(company.telefone),
        EMAIL: text(company.email),
      },
    },
  ];

  if (accountant) {
    records.push({
      code: "0100",
      values: {
        NOME: text(accountant.nome),
        CPF: digits(accountant.cpf),
        CRC: text(accountant.crc),
        CNPJ: text(accountant.cnpj_escritorio),
        CEP: digits(accountant.cep),
        END: text(accountant.endereco),
        NUM: text(accountant.numero),
        COMPL: text(accountant.complemento),
        BAIRRO: text(accountant.bairro),
        FONE: digits(accountant.telefone),
        FAX: digits(accountant.fax),
        EMAIL: text(accountant.email),
        COD_MUN: digits(accountant.codigo_municipio),
      },
    });
  }

  const paymentParticipants = new Map<string, {
    code: string;
    name: string;
    cnpj: string;
    sourceId: string;
  }>();
  for (const payment of payments1601) {
    const institutionCnpj = text(payment.instituicao_cnpj);
    if (institutionCnpj) paymentParticipants.set(text(payment.instituicao_codigo_participante), {
      code: text(payment.instituicao_codigo_participante),
      name: text(payment.instituicao_nome),
      cnpj: institutionCnpj,
      sourceId: text(payment.id),
    });
    const intermediaryCnpj = text(payment.intermediario_cnpj);
    if (intermediaryCnpj) paymentParticipants.set(text(payment.intermediario_codigo_participante), {
      code: text(payment.intermediario_codigo_participante),
      name: text(payment.intermediario_nome),
      cnpj: intermediaryCnpj,
      sourceId: text(payment.id),
    });
  }
  const catalogRecords: EfdRecord[] = [...(input.catalogRecords ?? [])];
  for (const participant of Array.from(paymentParticipants.values()).sort((left, right) => left.code.localeCompare(right.code, "en"))) {
    catalogRecords.push({
      code: "0150",
      values: {
        COD_PART: participant.code,
        NOME: participant.name,
        COD_PAIS: "01058",
        CNPJ: participant.cnpj,
      },
      source: { source: "IMPORTACAO", table: "fiscal_sped_1601_linha", id: participant.sourceId },
    });
  }

  const participants = new Map<string, EfdRecord>();
  const participantChanges = new Map<string, EfdRecord[]>();
  const units = new Map<string, EfdRecord>();
  const items = new Map<string, { item: EfdRecord; children: EfdRecord[] }>();
  const otherCatalog: EfdRecord[] = [];

  let currentItemCode: string | null = null;
  for (const record of catalogRecords) {
    if (record.code === "0150") {
      const code = text(record.values.COD_PART);
      if (code && !participants.has(code)) participants.set(code, record);
    } else if (record.code === "0175") {
      const code = text(record.source?.documentKey);
      if (code) participantChanges.set(code, [...(participantChanges.get(code) ?? []), record]);
    } else if (record.code === "0190") {
      const unit = text(record.values.UNID);
      if (unit && !units.has(unit)) units.set(unit, record);
    } else if (record.code === "0200") {
      const code = text(record.values.COD_ITEM);
      currentItemCode = code;
      if (code && !items.has(code)) {
        items.set(code, { item: record, children: [] });
      }
    } else if (["0205", "0220", "0221"].includes(record.code)) {
      const parentCode = text(record.source?.documentKey) || currentItemCode;
      if (parentCode && items.has(parentCode)) {
        const itemEntry = items.get(parentCode)!;
        const childKey = `${record.code}|${JSON.stringify(record.values)}`;
        if (!itemEntry.children.some((c) => `${c.code}|${JSON.stringify(c.values)}` === childKey)) {
          itemEntry.children.push(record);
        }
      }
    } else {
      const key = `${record.code}|${JSON.stringify(record.values)}`;
      if (!otherCatalog.some((c) => `${c.code}|${JSON.stringify(c.values)}` === key)) {
        otherCatalog.push(record);
      }
    }
  }

  // 1. 0150 ordenados por COD_PART, cada um seguido dos seus 0175
  for (const participant of Array.from(participants.values()).sort((a, b) =>
    text(a.values.COD_PART).localeCompare(text(b.values.COD_PART), "en"),
  )) {
    records.push(participant, ...(participantChanges.get(text(participant.values.COD_PART)) ?? []));
  }

  // 2. 0190 ordenados por UNID
  records.push(...Array.from(units.values()).sort((a, b) =>
    text(a.values.UNID).localeCompare(text(b.values.UNID), "en"),
  ));

  // 3. 0200 ordenados por COD_ITEM com filhos imediatamente aninhados
  const sortedItems = Array.from(items.values()).sort((a, b) =>
    text(a.item.values.COD_ITEM).localeCompare(text(b.item.values.COD_ITEM), "en"),
  );
  for (const { item, children } of sortedItems) {
    records.push(item);
    children.sort((a, b) => a.code.localeCompare(b.code, "en"));
    records.push(...children);
  }

  // 4. Outros registros cadastrais
  records.push(...otherCatalog);

  records.push(
    { code: "0990", values: {} },
    ...movement("B001", "B990"),
    { code: "C001", values: { IND_MOV: blockCRecords.length ? "0" : "1" } },
    ...blockCRecords,
    { code: "C990", values: {} },
    ...movement("D001", "D990"),
    { code: "E001", values: { IND_MOV: blockERecords.length ? "0" : "1" } },
    ...blockERecords,
    { code: "E990", values: {} },
    ...movement("G001", "G990"),
    { code: "H001", values: { IND_MOV: blockHRecords.length ? "0" : "1" } },
    ...blockHRecords,
    { code: "H990", values: {} },
    ...movement("K001", "K990"),
  );
  const hasBlock1Movement = payments1601.length > 0;
  const companyUf = text(input.company.estado || input.company.uf);
  const resolved1010 = resolve1010Indicators({
    uf: companyUf,
    config,
    hasElectronicPayments: hasBlock1Movement,
    hasExportOperations: (input.blockCRecords ?? []).some((r) => String(r.values?.CFOP ?? "").startsWith("7")),
    hasC176C179Operations: config?.c176_c179_aplicavel === true,
  });

  records.push({ code: "1001", values: { IND_MOV: hasBlock1Movement ? "0" : "1" } });
  records.push({
    code: "1010",
    values: resolved1010.indicators,
    source: { source: "CONFIGURACAO", table: "fiscal_sped_config" },
  });
  if (hasBlock1Movement) {
    for (const payment of payments1601) {
      records.push({
        code: "1601",
        values: {
          COD_PART_IP: text(payment.instituicao_codigo_participante),
          COD_PART_IT: text(payment.intermediario_codigo_participante),
          TOT_VS: payment.total_operacoes as number,
          TOT_ISS: payment.total_iss as number,
          TOT_OUTROS: payment.total_outros as number,
        },
        source: { source: "IMPORTACAO", table: "fiscal_sped_1601_linha", id: text(payment.id) },
      });
    }
  }
  records.push({ code: "1990", values: {} });
  return records;
}

/**
 * Contador de marcação para a PRÉVIA sem contador cadastrado: o PVA confere o
 * resto do arquivo em vez de parar no 0100. Nunca entra no arquivo FINAL, que
 * continua bloqueado por CONTABILISTA_AUSENTE.
 *
 * O CPF é fixo (000.000.001-91, número de teste conhecido, com dígitos
 * válidos) e não sorteado: um CPF válido ao acaso pode ser de uma pessoa real.
 * Endereço e município vêm do 0005/0000 da própria empresa, para passar nas
 * tabelas do PVA; os textos deixam claro que é prévia.
 */
export const PREVIEW_ACCOUNTANT_CPF = "00000000191";

export function withPreviewAccountantPlaceholder(records: readonly EfdRecord[]): EfdRecord[] {
  if (records.some((record) => record.code === "0100")) return [...records];
  const header = records.find((record) => record.code === "0000")?.values ?? {};
  const address = records.find((record) => record.code === "0005")?.values ?? {};
  const uf = text(header.UF) || "XX";
  const placeholder: EfdRecord = {
    code: "0100",
    values: {
      NOME: "CONTADOR NAO CADASTRADO - PREVIA",
      CPF: PREVIEW_ACCOUNTANT_CPF,
      CRC: `${uf}-000000/O-0`,
      CNPJ: "",
      CEP: digits(address.CEP) || "00000000",
      END: "PREVIA - CADASTRE O CONTADOR NO ERP",
      NUM: "SN",
      COMPL: "",
      BAIRRO: text(address.BAIRRO) || "PREVIA",
      FONE: "",
      FAX: "",
      EMAIL: "contador-nao-cadastrado@previa.invalid",
      COD_MUN: digits(header.COD_MUN),
    },
    source: { source: "CALCULO", table: "previa_contador_marcacao" },
  };
  // O 0100 vem depois de 0000/0001/0002/0005/0015 e antes dos cadastros (0150 em diante).
  const index = records.findIndex((record) => record.code[0] !== "0" || record.code > "0100");
  const position = index === -1 ? records.length : index;
  return [...records.slice(0, position), placeholder, ...records.slice(position)];
}

export function validateFoundation(input: {
  company: Company | null;
  config: Config;
  accountant: Accountant;
}): SpedDiagnostic[] {
  const diagnostics: SpedDiagnostic[] = [];
  if (!input.company) {
    diagnostics.push({ code: "EMPRESA_AUSENTE", severity: "BLOQUEIO", message: "Estabelecimento não encontrado." });
  }
  if (!input.config) {
    diagnostics.push({ code: "CONFIGURACAO_SPED_AUSENTE", severity: "BLOQUEIO", message: "Configuração fiscal do SPED não cadastrada." });
  } else {
    for (const [field, label] of [
      ["timezone_status", "timezone"],
      ["perfil_efd_status", "perfil EFD"],
      ["indicador_atividade_status", "indicador de atividade"],
    ] as const) {
      if (status(input.config, field) !== "CONFIRMADO") diagnostics.push({
        code: `GATE_${field.toUpperCase()}_NAO_CONFIRMADO`,
        severity: "BLOQUEIO",
        message: `A confirmação de ${label} é obrigatória para o fechamento.`,
      });
    }
    for (const [field, label] of [
      ["contribuinte_ipi_status", "condição de contribuinte de IPI"],
      ["entrega_efd_contribuicoes_status", "entrega da EFD-Contribuições"],
    ] as const) {
      if (status(input.config, field) === "PENDENTE") diagnostics.push({
        code: `GATE_${field.toUpperCase()}_PENDENTE`,
        severity: "BLOQUEIO",
        message: `A confirmação de ${label} está pendente.`,
      });
    }

    const uf = text(input.company?.estado || input.company?.uf);
    const resolved1010 = resolve1010Indicators({
      uf,
      config: input.config,
    });
    diagnostics.push(...resolved1010.diagnostics);
  }
  if (!input.accountant) diagnostics.push({ code: "CONTABILISTA_AUSENTE", severity: "BLOQUEIO", message: "Não há contabilista vigente para a competência. Cadastre o contador na aba Configuração." });
  return diagnostics;
}
