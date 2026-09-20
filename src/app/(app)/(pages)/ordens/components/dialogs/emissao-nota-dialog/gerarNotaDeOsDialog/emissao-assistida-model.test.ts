// Tela assistida × servidor: a prévia do item mostra exatamente o grupo ICMS
// que o servidor vai serializar e gravar. A tela nunca calcula ICMS próprio
// por conta própria a partir da alíquota do cadastro.

import "@/services/fiscal/__testEnv";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getNFeFiscalFieldRules } from "@/lib/nfe/taxRules";
import {
  aplicarAlteracoesComCienciaFiscal,
  classificarIssuesFiscais,
} from "@/lib/nfe/issuesFiscais";
import { prepararItemFiscal } from "@/services/fiscal/nfeAvulsaService";

import {
  calcularIcmsDoItem,
  createAssistedItem,
  toApiItem,
  toNFeItem,
  validateAssistedItem,
  valoresSemUsoNoCodigo,
  tratamentoIcmsDoItem,
  type AssistedFiscalItem,
  type FiscalSetup,
  type SourceProduct,
} from "./emissao-assistida-model";

const setup: FiscalSetup = {
  empresa: { id: 1, nome: "AUTO ELETRICA DEMIR LTDA", uf: "PB", crt: 3, ambiente: "PRODUCAO" },
  config: { serie: 3, ambiente: "PRODUCAO" },
  empresaErros: [],
  unidades: ["UN"],
  regrasFiscais: getNFeFiscalFieldRules(3),
  versaoRegraFiscal: "teste",
  classificacoesRtc: [{
    codigo: "000001",
    cst: "000",
    nome: "Tributação integral",
    inicioVigencia: "2026-01-01",
    permiteNfe: true,
    versaoFonte: "IT2025.002-v1.60-2026-06-22",
  }],
};

/** Produto da NF-e 136 como a rota de venda o devolve. */
const produto136: SourceProduct = {
  titulo: "UNIDADE DE CONTROLE VALVULA APM",
  osProdutoId: "164-1964",
  sourceItemId: "venda:164:183",
  produtoId: 1964,
  descricao: "UNIDADE DE CONTROLE VALVULA APM",
  quantidade: 1,
  precoUnitario: 11000,
  subtotal: 11000,
  ncm: "90328921",
  cfop: "5403",
  cfopCandidates: [{ value: "5403", origin: "PRODUTO" }],
  codigobarras: null,
  unidade: "UN",
  origem_mercadoria: "0",
  cst: "60",
  cest: "0104700",
  aliquotaicms: 20,
  cst_pis: "04",
  cst_cofins: "04",
  rtc_habilitado: true,
  cst_ibscbs: "000",
  cclass_trib: "000001",
  aliquota_ibs_uf: 0.1,
  aliquota_ibs_municipio: 0,
  aliquota_cbs: 0.9,
  procedenciaFiscal: { cst: "PRODUTO", aliquotaicms: "PRODUTO", cfop: "PRODUTO" },
};

function itemMG(overrides: Partial<AssistedFiscalItem> = {}): AssistedFiscalItem {
  return {
    ...createAssistedItem(produto136, setup, {
      tipoOperacao: "SAIDA",
      parceiroUf: "MG",
      indFinal: 0,
      indIEDest: 1,
      modelo: 55,
    }),
    ...overrides,
  };
}

/** O que o servidor faria com o item que a tela envia. */
function noServidor(item: AssistedFiscalItem) {
  return prepararItemFiscal(toApiItem(item, setup), 0, 3);
}

describe("tela assistida — regressão da NF-e 136", () => {
  it("o CFOP do produto é adaptado à geografia e o CST fica como veio", () => {
    const item = itemMG();
    assert.equal(item.cfop, "6403");
    assert.equal(item.cst, "60");
    assert.equal(item.aliquotaIcms, "20");
  });

  it("a prévia não mostra ICMS próprio para CST 60, e o servidor concorda", () => {
    const item = itemMG();
    const tela = toNFeItem(item, 0, setup).icms;
    assert.equal(tela?.grupoXml, "ICMS60");
    assert.equal(tela?.vBC, null);
    assert.equal(tela?.vICMS, null);
    assert.deepEqual(noServidor(item).nfeItem.icms, tela);
  });

  it("a alíquota do cadastro aparece como não usada, com o motivo", () => {
    const [ignorado] = calcularIcmsDoItem(itemMG(), setup).camposIgnorados;
    assert.equal(ignorado?.campo, "aliquotaicms");
    assert.equal(ignorado?.origem, "PRODUTO");
  });

  it("6403 com CST 60 pede ciência, e a ciência libera o item", () => {
    const pendente = validateAssistedItem(itemMG(), setup, { parceiroUf: "MG" });
    const aviso = pendente.find((issue) => issue.requerCiencia);
    assert.equal(aviso?.code, "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO");
    assert.deepEqual(classificarIssuesFiscais(pendente).bloqueios, []);
    assert.equal(classificarIssuesFiscais(pendente).avisos.includes(aviso!), true);

    const confirmado = validateAssistedItem(
      itemMG({ avisosFiscaisConfirmados: ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"] }),
      setup,
      { parceiroUf: "MG" },
    );
    assert.deepEqual(confirmado, []);
    assert.deepEqual(noServidor(itemMG({ avisosFiscaisConfirmados: ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"] })).avisosPendentes, []);
  });

  it("CST 60 + CFOP 6404 + indFinal=0 apresenta a política de ST retida como AVISO", () => {
    const issues = validateAssistedItem(itemMG({ cfop: "6404" }), setup, {
      parceiroUf: "MG",
      indFinal: 0,
    });
    const classificadas = classificarIssuesFiscais(issues);
    const aviso = classificadas.avisos.find((issue) => issue.code === "NFE_ST_RETIDA_POLITICA_UF");

    assert.equal(aviso?.requerCiencia, true);
    assert.equal(classificadas.bloqueios.some((issue) => issue.code === aviso?.code), false);
    assert.equal(classificadas.pronto, false);
  });

  it("CST 60 + indFinal=1 apresenta a política de ICMS efetivo como AVISO", () => {
    const issues = validateAssistedItem(itemMG({ cfop: "6404" }), setup, {
      parceiroUf: "MG",
      indFinal: 1,
    });
    const classificadas = classificarIssuesFiscais(issues);
    const aviso = classificadas.avisos.find((issue) => issue.code === "NFE_ICMS_EFETIVO_POLITICA_UF");

    assert.equal(aviso?.requerCiencia, true);
    assert.equal(classificadas.bloqueios.some((issue) => issue.code === aviso?.code), false);
  });

  it("aviso confirmado deixa o item pronto e mudança de CFOP pede ciência novamente", () => {
    const confirmado = itemMG({
      cfop: "6404",
      avisosFiscaisConfirmados: [
        "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO",
        "NFE_ST_RETIDA_POLITICA_UF",
      ],
    });
    const semPendencias = validateAssistedItem(confirmado, setup, {
      parceiroUf: "MG",
      indFinal: 0,
    });
    assert.equal(classificarIssuesFiscais(semPendencias).pronto, true);

    const alterado = aplicarAlteracoesComCienciaFiscal(confirmado, { cfop: "6403" });
    const novasIssues = validateAssistedItem(alterado, setup, {
      parceiroUf: "MG",
      indFinal: 0,
    });
    const classificadas = classificarIssuesFiscais(novasIssues);

    assert.deepEqual(alterado.avisosFiscaisConfirmados, []);
    assert.equal(classificadas.avisos.some((issue) => issue.code === "NFE_ST_RETIDA_POLITICA_UF"), true);
    assert.deepEqual(classificadas.bloqueios, []);
  });
});

describe("tela assistida — campos acompanham o CST", () => {
  it("CST 00: BC e ICMS próprios iguais na tela e no servidor", () => {
    const item = itemMG({ cfop: "6102", cst: "00" });
    const tela = toNFeItem(item, 0, setup).icms;
    assert.equal(tela?.vBC, 11000);
    assert.equal(tela?.vICMS, 2200);
    assert.deepEqual(noServidor(item).nfeItem.icms, tela);
  });

  it("6404 + CST 10 incompleto não gera falso aviso e mostra cada pendência ST uma vez", () => {
    const item = itemMG({
      cfop: "6404",
      cst: "10",
      modBCST: "",
      pMVAST: "",
      vBCST: "",
      pICMSST: "",
      vICMSST: "",
    });
    const calculado = calcularIcmsDoItem(item, setup);
    const issues = validateAssistedItem(item, setup, { parceiroUf: "MG", indFinal: 0 });
    const pendenciasSt = issues.filter((issue) => issue.field.startsWith("icms.st."));

    assert.equal(issues.some((issue) => issue.code.startsWith("NFE_CFOP_")), false);
    assert.deepEqual(
      pendenciasSt.map((issue) => issue.code).sort(),
      ["NFE_ICMS_MODBCST_REQUIRED", "NFE_ICMS_PICMSST_REQUIRED", "NFE_ICMS_VBCST_REQUIRED"].sort(),
    );
    assert.equal(issues.some((issue) => issue.code === "NFE_ICMS_CAMPO_OBRIGATORIO"), false);
    assert.equal(calculado.valores?.vBC, 11000);
    assert.equal(calculado.valores?.vICMS, 2200);
  });

  it("6404 + CST 10 completo mantém ICMS próprio + ST e não gera aviso CFOP × CST", () => {
    const item = itemMG({
      cfop: "6404",
      cst: "10",
      modBCST: "4",
      pMVAST: "40",
      pICMSST: "18",
    });
    const calculado = calcularIcmsDoItem(item, setup);
    const issues = validateAssistedItem(item, setup, { parceiroUf: "MG", indFinal: 0 });

    assert.equal(issues.some((issue) => issue.code.startsWith("NFE_CFOP_")), false);
    assert.equal(calculado.valores?.vBC, 11000);
    assert.equal(calculado.valores?.vICMS, 2200);
    assert.equal(calculado.valores?.vBCST, 15400);
    assert.equal(calculado.valores?.vICMSST, 572);
  });

  it("CST 60 com ST retida manda só o bloco de ST retida", () => {
    const item = itemMG({ cfop: "6404", vBCSTRet: "13200", pST: "18", vICMSSTRet: "1656" });
    const api = toApiItem(item, setup);
    assert.deepEqual(Object.keys(api.icms ?? {}), ["stRetida"]);
    const servidor = noServidor(item);
    assert.deepEqual(servidor.bloqueios, []);
    assert.equal(servidor.nfeItem.icms?.vICMSSTRet, 1656);
  });

  it("valores de ST digitados num CST 10 ficam guardados, mas não vão ao CST 60", () => {
    const comSt = itemMG({
      cfop: "6403",
      cst: "10",
      modBCST: "4",
      pMVAST: "40",
      pICMSST: "18",
    });
    assert.equal(toNFeItem(comSt, 0, setup).icms?.vBCST, 15400);

    const trocado = { ...comSt, cst: "60" };
    const sobras = valoresSemUsoNoCodigo(trocado, tratamentoIcmsDoItem(trocado, setup));
    assert.deepEqual(sobras.map((sobra) => sobra.rotulo), ["Modalidade da BC ST", "MVA ST (%)", "Alíquota ST (%)"]);
    assert.equal("st" in (toApiItem(trocado, setup).icms ?? {}), false);
    assert.deepEqual(noServidor(trocado).bloqueios, []);
  });

  it("CST 90 só destaca ICMS próprio quando o usuário liga a opção", () => {
    const semDestaque = itemMG({ cfop: "6102", cst: "90" });
    assert.equal(toNFeItem(semDestaque, 0, setup).icms?.vICMS, null);
    const comDestaque = { ...semDestaque, icmsDestacarProprio: true };
    assert.equal(toNFeItem(comDestaque, 0, setup).icms?.vICMS, 2200);
    assert.deepEqual(noServidor(comDestaque).nfeItem.icms, toNFeItem(comDestaque, 0, setup).icms);
  });

  it("CST 20 exige a redução e a aplica na base", () => {
    const semReducao = itemMG({ cfop: "6102", cst: "20" });
    assert.ok(validateAssistedItem(semReducao, setup, { parceiroUf: "MG" }).some((issue) => issue.code === "NFE_ICMS_PREDBC_REQUIRED"));
    const comReducao = { ...semReducao, pRedBC: "50" };
    assert.equal(toNFeItem(comReducao, 0, setup).icms?.vBC, 5500);
  });
});

describe("tela assistida — frete na base do ICMS", () => {
  it("a prévia soma o frete do item na base como o servidor", () => {
    const item = itemMG({ cfop: "6102", cst: "00" });
    const contexto = { valorFrete: 500, freteIntegraBaseIcms: true };
    const tela = toNFeItem(item, 0, setup, contexto).icms;
    assert.equal(tela?.vBC, 11500);
    assert.equal(tela?.vICMS, 2300);
    const servidor = prepararItemFiscal({ ...toApiItem(item, setup), valorFrete: 500 }, 0, 3, { freteIntegraBaseIcms: true });
    assert.deepEqual(servidor.nfeItem.icms, tela);
  });

  it("frete fora da base própria continua na base da ST", () => {
    const item = itemMG({ cfop: "6403", cst: "10", modBCST: "4", pMVAST: "40", pICMSST: "18" });
    const tela = toNFeItem(item, 0, setup, { valorFrete: 500, freteIntegraBaseIcms: false }).icms;
    assert.equal(tela?.vBC, 11000);
    assert.equal(tela?.vBCST, 16100);
  });
});
