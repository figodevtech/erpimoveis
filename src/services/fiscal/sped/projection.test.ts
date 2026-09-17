import assert from "node:assert/strict";
import test from "node:test";

import { resolveSpedLayout, serializeEfd } from "@/lib/sped/efd-icms-ipi";
import { buildFoundationRecords } from "./projection";

const mockCompany = {
  id: 1,
  razaosocial: "AUTO ELETRICA DEMIR LTDA",
  nomefantasia: "DEMIR DIESEL",
  cnpj: "12260723000109",
  inscricaoestadual: "161726542",
  codigomunicipio: "2507507",
  uf: "PB",
  cep: "58000000",
  endereco: "Rua Principal",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  telefone: "8333334444",
  email: "contato@demir.com.br",
  inscricaomunicipal: "",
};

const mockConfig = {
  perfil_efd: "B",
  indicador_atividade: "1",
  registro_1400_aplicavel: false,
};

const layout = resolveSpedLayout("2026-08");

test("Bloco 1 sem movimento: gera 1001 com IND_MOV=1 e não gera 1010", () => {
  const records = buildFoundationRecords({
    competence: "2026-08",
    company: mockCompany as any,
    config: mockConfig as any,
    accountant: null,
    payments1601: [],
    catalogRecords: [],
    blockCRecords: [],
    blockERecords: [],
    blockHRecords: [],
  });

  const codes = records.map((r) => r.code);
  assert.ok(codes.includes("1001"));
  assert.ok(codes.includes("1990"));
  assert.equal(codes.includes("1010"), false);
  assert.equal(codes.includes("1601"), false);

  const reg1001 = records.find((r) => r.code === "1001");
  assert.equal(reg1001?.values.IND_MOV, "1");

  const serialized = serializeEfd(records, layout);
  assert.ok(serialized.text.includes("|1001|1|\r\n"));
  assert.ok(serialized.text.includes("|1990|2|\r\n"));
});

test("Bloco 1 com movimento 1601: gera 1001 com IND_MOV=0, registro 1010 (IND_CART=S) e 1601", () => {
  const mockPayment = {
    id: "pay-1",
    instituicao_codigo_participante: "PART_INST_01",
    instituicao_nome: "STONE PAGAMENTOS",
    instituicao_cnpj: "16501555000157",
    intermediario_codigo_participante: "",
    intermediario_nome: "",
    intermediario_cnpj: "",
    total_operacoes: 1500.5,
    total_iss: 0,
    total_outros: 0,
  };

  const records = buildFoundationRecords({
    competence: "2026-08",
    company: mockCompany as any,
    config: mockConfig as any,
    accountant: null,
    payments1601: [mockPayment as any],
    catalogRecords: [],
    blockCRecords: [],
    blockERecords: [],
    blockHRecords: [],
  });

  const codes = records.map((r) => r.code);
  const idx1001 = codes.indexOf("1001");
  assert.ok(idx1001 >= 0);
  assert.equal(codes[idx1001 + 1], "1010");
  assert.equal(codes[idx1001 + 2], "1601");
  assert.equal(codes[idx1001 + 3], "1990");

  const reg1001 = records.find((r) => r.code === "1001");
  assert.equal(reg1001?.values.IND_MOV, "0");

  const reg1010 = records.find((r) => r.code === "1010");
  assert.ok(reg1010);
  assert.equal(reg1010?.values.IND_CART, "S");
  assert.equal(reg1010?.values.IND_VA, "N");
  assert.equal(reg1010?.values.IND_EXP, "N");
  assert.equal(reg1010?.values.IND_REST_RESSARC_COMPL_ICMS, "N");

  const serialized = serializeEfd(records, layout);
  assert.ok(serialized.text.includes("|1001|0|\r\n"));
  assert.ok(serialized.text.includes("|1010|N|N|N|N|N|N|S|N|N|N|N|N|N|\r\n"));
  assert.ok(serialized.text.includes("|1601|PART_INST_01||1500,50|0,00|0,00|\r\n"));
});
