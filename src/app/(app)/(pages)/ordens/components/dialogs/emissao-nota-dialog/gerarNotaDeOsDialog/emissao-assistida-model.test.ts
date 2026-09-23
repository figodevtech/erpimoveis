// Tela assistida × servidor: a prévia do item mostra exatamente o grupo ICMS
// que o servidor vai serializar e gravar. A tela nunca calcula ICMS próprio
// por conta própria a partir da alíquota do cadastro.

import "@/services/fiscal/__testEnv";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getNFeFiscalFieldRules } from "@/lib/nfe/taxRules";
import { MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import {
  aplicarAlteracoesComCienciaFiscal,
  classificarIssuesFiscais,
  confirmarAvisosFiscais,
} from "@/lib/nfe/issuesFiscais";
import { prepararItemFiscal } from "@/services/fiscal/nfeAvulsaService";

import { aplicarSugestaoDifal } from "@/lib/nfe/difal-sugestao";

import {
  aplicarResolucaoDifal,
  assinaturaDifalDe,
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
function noServidor(item: AssistedFiscalItem, contexto: Parameters<typeof prepararItemFiscal>[3] = {}) {
  return prepararItemFiscal(toApiItem(item, setup), 0, 3, contexto);
}

/**
 * Ciências como o servidor as teria gravado em nfe_ciencia_aviso para as
 * chaves marcadas na tela. O payload sozinho não libera nada.
 */
function registradasPeloServidor(item: AssistedFiscalItem) {
  return new Map(
    item.avisosFiscaisConfirmados.map((chave, indice) => [
      chave,
      { id: indice + 1, usuarioId: "00000000-0000-4000-8000-0000000000a1", confirmadoEm: "2026-09-22T20:00:00-03:00" },
    ]),
  );
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

    const itemConfirmado = confirmarAvisosFiscais(itemMG(), [aviso!]);
    assert.deepEqual(itemConfirmado.avisosFiscaisConfirmados, [`${aviso!.code}@${aviso!.fingerprint}`]);
    const confirmado = validateAssistedItem(itemConfirmado, setup, { parceiroUf: "MG" });
    assert.deepEqual(confirmado, []);
    // A chave no payload não basta: o servidor exige a ciência que ele gravou.
    assert.deepEqual(
      noServidor(itemConfirmado).avisosPendentes.map((issue) => issue.code),
      ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"],
    );
    // Gravada para a mesma situação (mesmo fingerprint), ela libera.
    assert.deepEqual(noServidor(itemConfirmado, { ciencias: registradasPeloServidor(itemConfirmado) }).avisosPendentes, []);
  });

  it("confirmação só com o código (legado ou manipulada) não libera, nem na tela nem no servidor", () => {
    const soCodigo = itemMG({ avisosFiscaisConfirmados: ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"] });
    assert.equal(
      validateAssistedItem(soCodigo, setup, { parceiroUf: "MG" }).some((issue) => issue.requerCiencia),
      true,
    );
    assert.deepEqual(
      noServidor(soCodigo).avisosPendentes.map((issue) => issue.code),
      ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"],
    );
  });

  it("ciência forjada para outra situação não engana o servidor", () => {
    const [aviso6404] = validateAssistedItem(itemMG({ cfop: "6404" }), setup, { parceiroUf: "MG" }).filter(
      (issue) => issue.requerCiencia,
    );
    // Ciência gravada para 6404 + CST 60 não serve para um item 6403 + CST 60.
    const forjado = itemMG({ avisosFiscaisConfirmados: [`${aviso6404.code}@${aviso6404.fingerprint}`] });
    assert.deepEqual(
      noServidor(forjado, { ciencias: registradasPeloServidor(forjado) }).avisosPendentes.map((issue) => issue.code),
      ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"],
    );
  });

  it("ciência registrada no snapshot leva o fingerprint, as fontes e quem confirmou", () => {
    const [aviso] = validateAssistedItem(itemMG(), setup, { parceiroUf: "MG" }).filter((issue) => issue.requerCiencia);
    const item = confirmarAvisosFiscais(itemMG(), [aviso]);
    const [confirmado] =
      noServidor(item, { ciencias: registradasPeloServidor(item) }).nfeItem.icmsDecisao?.avisosConfirmados ?? [];
    assert.equal(confirmado?.code, "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO");
    assert.equal(confirmado?.fingerprint, aviso.fingerprint);
    assert.ok(confirmado?.fontes?.length);
    assert.equal(confirmado?.ciencia?.usuarioId, "00000000-0000-4000-8000-0000000000a1");
    // Sem ciência gravada, nada entra no snapshot, mesmo com a chave no payload.
    assert.deepEqual(noServidor(item).nfeItem.icmsDecisao?.avisosConfirmados, []);
  });

  it("alterar a decisão de ST (CST 90) invalida a ciência sem limpar a lista", () => {
    const base = itemMG({ cfop: "5405", cst: "90", icmsReterSt: false });
    const [aviso] = validateAssistedItem(base, setup, { parceiroUf: "SP" }).filter((issue) => issue.requerCiencia);
    assert.equal(aviso?.code, "NFE_CFOP_ST_SUBSTITUIDO_SEM_ST_ANTERIOR");
    const confirmado = confirmarAvisosFiscais(base, [aviso]);
    assert.equal(
      validateAssistedItem(confirmado, setup, { parceiroUf: "SP" }).some((issue) => issue.requerCiencia),
      false,
    );
    const comSt = aplicarAlteracoesComCienciaFiscal(confirmado, {
      icmsReterSt: true,
      modBCST: "4",
      pMVAST: "40",
      pICMSST: "18",
    });
    assert.deepEqual(comSt.avisosFiscaisConfirmados, confirmado.avisosFiscaisConfirmados);
    assert.deepEqual(
      validateAssistedItem(comSt, setup, { parceiroUf: "SP" })
        .filter((issue) => issue.requerCiencia)
        .map((issue) => issue.code),
      ["NFE_CFOP_ST_SUBSTITUIDO_SEM_ST_ANTERIOR"],
    );
  });

  it("CST 60 + indFinal=0 apresenta ST retida como INFO e mantém o item pronto", () => {
    const issues = validateAssistedItem(itemMG({ cfop: "6411" }), setup, {
      parceiroUf: "MG",
      indFinal: 0,
    });
    const classificadas = classificarIssuesFiscais(issues);
    const informativo = classificadas.informativos.find((issue) => issue.code === "NFE_ST_RETIDA_POLITICA_UF");

    assert.equal(informativo?.severidade, "INFO");
    assert.equal(informativo?.requerCiencia, false);
    assert.deepEqual(classificadas.bloqueios, []);
    assert.deepEqual(classificadas.avisosComCiencia, []);
    assert.equal(classificadas.pronto, true);
  });

  it("CST 60 + indFinal=1 apresenta ICMS efetivo como INFO sem ciência", () => {
    const issues = validateAssistedItem(itemMG({ cfop: "6411" }), setup, {
      parceiroUf: "MG",
      indFinal: 1,
    });
    const classificadas = classificarIssuesFiscais(issues);
    const informativo = classificadas.informativos.find((issue) => issue.code === "NFE_ICMS_EFETIVO_POLITICA_UF");

    assert.equal(informativo?.severidade, "INFO");
    assert.equal(informativo?.requerCiencia, false);
    assert.deepEqual(classificadas.avisosComCiencia, []);
    assert.equal(classificadas.pronto, true);
  });

  it("aviso confirmado deixa o item pronto e mudança de CFOP pede ciência novamente", () => {
    const item6404 = itemMG({ cfop: "6404" });
    const confirmado = confirmarAvisosFiscais(
      item6404,
      validateAssistedItem(item6404, setup, { parceiroUf: "MG", indFinal: 0 }),
    );
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
    assert.equal(
      classificadas.avisos.some((issue) => issue.code === "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"),
      true,
    );
    assert.equal(
      classificadas.informativos.some((issue) => issue.code === "NFE_ST_RETIDA_POLITICA_UF"),
      true,
    );
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

describe("seletor de NCM × motor de DIFAL", () => {
  const base = {
    ufDestino: "PI",
    indFinal: 1,
    indIEDest: 9,
    crt: 3,
    modelo: MODELO_NFE,
  };
  const item = (ncm: string) => [{ sourceItemId: "venda:180:203", ncm, cest: "0199900", cfop: "6108", cst: "60", orig: "0" }];

  it("trocar o NCM muda a assinatura fiscal, que é o gatilho da nova resolução", () => {
    // É esta mudança que faz o diálogo chamar /api/fiscal/difal/resolver de
    // novo. Sem ela, o combobox trocaria o código e o DIFAL continuaria o da
    // mercadoria anterior.
    const antes = assinaturaDifalDe({ ...base, itens: item("90328921") });
    const depois = assinaturaDifalDe({ ...base, itens: item("90328925") });

    assert.notEqual(antes, depois);
  });

  it("o mesmo NCM com pontuação não refaz a resolução à toa", () => {
    assert.equal(
      assinaturaDifalDe({ ...base, itens: item("90328925") }),
      assinaturaDifalDe({ ...base, itens: item("9032.89.25") }),
    );
  });

  it("mexer em campo que não é fiscal não dispara resolução", () => {
    const comum = { sourceItemId: "venda:180:203", ncm: "90328925", cest: "0199900", cfop: "6108", cst: "60", orig: "0" };
    assert.equal(
      assinaturaDifalDe({ ...base, itens: [comum] }),
      assinaturaDifalDe({ ...base, itens: [{ ...comum }] }),
    );
  });

  it("o item guarda só o código do NCM, nunca o rótulo", () => {
    const assistido = createAssistedItem({ ...produto136, ncm: "90328925" }, setup, {
      tipoOperacao: "SAIDA",
      parceiroUf: "PI",
      indFinal: 1,
      indIEDest: 9,
    });

    assert.equal(assistido.ncm, "90328925");
    assert.ok(!assistido.ncm.includes("—"));
    assert.equal(toApiItem(assistido).ncm, "90328925");
  });
});

describe("invalidação do DIFAL enquanto o servidor não responde", () => {
  // O item vem de um contexto anterior (PB -> PI, 12%). O destino continua PI,
  // mas o emitente passou a ser SP, onde a interestadual é 7%.
  const doContextoAnterior = () => ({
    sourceItemId: "avulsa:0",
    orig: "0",
    cfop: "6108",
    difalHabilitado: true,
    difalAliquotaInterna: "22.5",
    difalAliquotaInterestadual: "12",
    difalAliquotaFcp: "0",
    difalPercentualPartilha: "100",
    difalResolucao: null,
    difalCamposManuais: [] as never[],
  });
  const contexto = {
    ufEmitente: "SP",
    ufDestinatario: "PI",
    tipoOperacao: "SAIDA" as const,
    indFinal: 1,
    indIEDest: 9,
    crt: 3,
    modelo: MODELO_NFE,
  };
  const chave = (_: unknown, index: number) => `avulsa:${index}`;

  it("limpar antes de sugerir devolve a interestadual do contexto novo", () => {
    // A alíquota interestadual e a partilha não dependem do banco: saem da
    // origem da mercadoria e da geografia. Limpar primeiro e sugerir depois
    // deixa as duas corretas mesmo que a consulta ao motor falhe.
    const limpo = aplicarResolucaoDifal([doContextoAnterior()], new Map(), chave)[0];
    const sugerido = aplicarSugestaoDifal(limpo, contexto);

    assert.equal(sugerido.difalAliquotaInterestadual, "7", "SP -> PI é 7%");
    assert.equal(sugerido.difalPercentualPartilha, "100");
    // O que depende do banco continua vazio, e é isso que bloqueia a emissão.
    assert.equal(limpo.difalAliquotaInterna, "");
    assert.equal(limpo.difalAliquotaFcp, "");
  });

  it("sugerir antes de limpar perde os dois campos dedutíveis", () => {
    // `aplicarSugestaoDifal` só preenche campo vazio: com o valor antigo ainda
    // presente ela não faz nada, e a limpeza seguinte apaga tudo.
    const sugerido = aplicarSugestaoDifal(doContextoAnterior(), contexto);
    const depois = aplicarResolucaoDifal([sugerido], new Map(), chave)[0];

    assert.equal(depois.difalAliquotaInterestadual, "");
    assert.equal(depois.difalPercentualPartilha, "");
  });

  it("campo marcado como manual sobrevive à invalidação", () => {
    const comManual = { ...doContextoAnterior(), difalCamposManuais: ["aliquotaFcp"] as never[] };
    const limpo = aplicarResolucaoDifal([comManual], new Map(), chave)[0];

    assert.equal(limpo.difalAliquotaFcp, "0", "a pessoa decidiu; não se apaga");
    assert.equal(limpo.difalAliquotaInterna, "");
  });
});

describe("tela assistida — ciência da base IBS/CBS manual", () => {
  const contexto = { parceiroUf: "MG", indFinal: 0, dataEmissao: "2026-09-22", modFrete: "9" } as const;
  const noServidorEm = (item: AssistedFiscalItem) =>
    prepararItemFiscal(toApiItem(item, setup), 0, 3, {
      dataEmissao: "2026-09-22",
      modFrete: "9",
      ciencias: registradasPeloServidor(item),
    });
  const comBaseManual = (overrides: Partial<AssistedFiscalItem> = {}) =>
    itemMG({ cfop: "6102", cst: "00", baseRtc: "9000", ...overrides });

  it("tela e servidor calculam o mesmo fingerprint, e a ciência da tela libera no servidor", () => {
    const item = comBaseManual();
    const [aviso] = validateAssistedItem(item, setup, contexto).filter((issue) => issue.code === "NFE_IBSCBS_BASE_MANUAL");
    assert.ok(aviso?.fingerprint);
    const [servidor] = noServidorEm(item).avisosPendentes.filter((issue) => issue.code === "NFE_IBSCBS_BASE_MANUAL");
    assert.equal(servidor?.fingerprint, aviso.fingerprint);

    const confirmado = confirmarAvisosFiscais(item, [aviso]);
    assert.deepEqual(noServidorEm(confirmado).avisosPendentes, []);
    assert.equal(
      validateAssistedItem(confirmado, setup, contexto).some((issue) => issue.code === "NFE_IBSCBS_BASE_MANUAL"),
      false,
    );
  });

  it("alterar base, desconto ou frete depois da ciência pede ciência de novo", () => {
    const item = comBaseManual();
    const [aviso] = validateAssistedItem(item, setup, contexto).filter((issue) => issue.requerCiencia);
    const confirmado = confirmarAvisosFiscais(item, [aviso]);
    const pendente = (alterado: AssistedFiscalItem, extra: object = {}) =>
      validateAssistedItem(alterado, setup, { ...contexto, ...extra }).some(
        (issue) => issue.code === "NFE_IBSCBS_BASE_MANUAL" && issue.requerCiencia,
      );

    assert.equal(pendente(confirmado), false);
    assert.equal(pendente(aplicarAlteracoesComCienciaFiscal(confirmado, { baseRtc: "8000" })), true);
    assert.equal(pendente(aplicarAlteracoesComCienciaFiscal(confirmado, { valorDesconto: 100 })), true);
    assert.equal(pendente(confirmado, { valorFrete: 50, modFrete: "0" }), true);
  });

  it("INFO nunca entra em avisosFiscaisConfirmados", () => {
    const item = itemMG({ cfop: "6411" });
    const issues = validateAssistedItem(item, setup, { parceiroUf: "MG", indFinal: 0 });
    assert.ok(issues.some((issue) => issue.severidade === "INFO"));
    assert.deepEqual(confirmarAvisosFiscais(item, issues).avisosFiscaisConfirmados, []);
  });
});
