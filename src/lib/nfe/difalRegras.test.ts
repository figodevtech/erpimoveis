import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildIcmsUFDestXml,
  deveGerarICMSUFDest,
  issuesDifalDoItem,
  resolverDifalDoItem,
} from "./difal";
import { casarRegrasDifal, type RegraDifal } from "./difalRegras";
import { resolverRegraDifalComRegras } from "@/services/fiscal/difal/resolverRegraDifal";
import type { NFeItem } from "./types";

/**
 * Cenário de referência: venda interestadual da Demir Diesel (PB) para
 * consumidor final não contribuinte no PI, mercadoria nacional, CRT 3,
 * NF-e 55 de saída. A regra geral do PI vale 22,5% desde 01/04/2025 e o Portal
 * Nacional do DIFAL declara que a regra geral não tem FCP — por isso o FCP
 * resolvido é 0, e não "em branco".
 */
const PI_GERAL_ATUAL: RegraDifal = {
  id: 1,
  uf: "PI",
  tipoRegra: "GERAL",
  descricao: "REGRA GERAL (ALÍQUOTA MODAL 22,5%)",
  ncm: null,
  ncmPrefixo: null,
  cest: null,
  aliquotaIcmsInterna: 22.5,
  aliquotaFcp: 0,
  reducaoBase: null,
  vigenciaInicio: "2025-04-01",
  vigenciaFim: null,
  prioridade: 10,
  fonte: "Portal Nacional do DIFAL (SVRS/ENCAT)",
  fonteUrl: "https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas",
  fundamentoLegal: "Lei nº 8.558/2024",
  dataFonte: "2025-04-01",
  ativo: true,
};

const PI_GERAL_ANTERIOR: RegraDifal = {
  ...PI_GERAL_ATUAL,
  id: 2,
  descricao: "REGRA GERAL (MODAL 21%)",
  aliquotaIcmsInterna: 21,
  aliquotaFcp: 0,
  vigenciaInicio: "2023-03-08",
  vigenciaFim: "2025-03-31",
  fundamentoLegal: 'Lei nº 4.257/89 (art. 23, I, "c")',
};

const regra = (patch: Partial<RegraDifal>): RegraDifal => ({ ...PI_GERAL_ATUAL, ...patch });

/** NCM controlado: 8708.99.90 — partes e acessórios de veículos automóveis. */
const NCM_PECA = "87089990";
const CEST_PECA = "0106700";

const CONTEXTO_DEMIR = {
  ufEmitente: "PB",
  ufDestino: "PI",
  dataEmissao: "2026-09-22",
  crt: 3,
  indFinal: 1,
  indIEDest: 9,
  tpNF: 1,
  modelo: 55,
  ncm: NCM_PECA,
  origemMercadoria: "0",
  cfop: "6108",
  cst: "00",
};

function itemDifal(patch: Partial<NFeItem> = {}): NFeItem {
  return {
    numeroItem: 1,
    codigoProduto: "1",
    descricao: "Bico injetor",
    ncm: NCM_PECA,
    cfop: "6108",
    unidade: "UN",
    quantidade: 1,
    valorUnitario: 7500,
    valorTotal: 7500,
    cst: "00",
    cstIcms: "00",
    orig: "0",
    ...patch,
  } as NFeItem;
}

const CONTEXTO_ITEM = {
  ufEmitente: "PB",
  ufDestinatario: "PI",
  indFinal: 1,
  indIEDest: 9,
  tpNF: 1,
  crt: 3,
  modelo: 55,
  dataEmissao: "2026-09-22",
};

describe("1. PB → PI, consumidor final não contribuinte, regra geral vigente", () => {
  it("resolve interna, interestadual, FCP e partilha sem exigir digitação", () => {
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [PI_GERAL_ATUAL, PI_GERAL_ANTERIOR]);

    assert.equal(saida.exigeDifal, true);
    assert.equal(saida.aliquotaInterna, 22.5);
    assert.equal(saida.aliquotaInterestadual, 12);
    assert.equal(saida.aliquotaFcp, 0);
    assert.equal(saida.percentualPartilha, 100);
    assert.equal(saida.resolvidoAutomaticamente, true);
    assert.deepEqual(saida.pendencias, []);
  });

  it("carrega a proveniência: regra, vigência, fonte e fundamento", () => {
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [PI_GERAL_ATUAL]);

    assert.equal(saida.origemAliquotaInterna, "REGRA_UF");
    assert.equal(saida.regraAliquotaInterna?.regraId, 1);
    assert.equal(saida.regraAliquotaInterna?.vigenciaInicio, "2025-04-01");
    assert.equal(saida.regraAliquotaInterna?.fundamentoLegal, "Lei nº 8.558/2024");
    assert.match(saida.regraAliquotaInterna?.fonte ?? "", /Portal Nacional do DIFAL/);
  });
});

describe("2 e 3. FCP resolvido automaticamente", () => {
  it("devolve 0 quando a regra declara que não há FCP", () => {
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [PI_GERAL_ATUAL]);
    assert.equal(saida.aliquotaFcp, 0);
    assert.equal(saida.origemFcp, "REGRA_UF");
    assert.ok(!saida.pendencias.includes("FCP_NAO_DETERMINADO"));
  });

  it("devolve o percentual quando a regra determina FCP maior que zero", () => {
    const rj = regra({ id: 9, uf: "RJ", aliquotaIcmsInterna: 18, aliquotaFcp: 2 });
    const saida = resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, ufDestino: "RJ" }, [rj]);

    assert.equal(saida.aliquotaInterna, 18);
    assert.equal(saida.aliquotaFcp, 2);
    assert.equal(saida.resolvidoAutomaticamente, true);
  });
});

describe("4 e 5. null de FCP bloqueia, 0 de FCP não bloqueia", () => {
  it("bloqueia quando nenhuma regra determina o FCP", () => {
    const semFcp = regra({ aliquotaFcp: null });
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [semFcp]);

    assert.equal(saida.aliquotaFcp, null);
    assert.ok(saida.pendencias.includes("FCP_NAO_DETERMINADO"));
    assert.equal(saida.resolvidoAutomaticamente, false);
  });

  it("não bloqueia quando o FCP resolvido é zero", () => {
    const item = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, { regras: [PI_GERAL_ATUAL] });

    assert.equal(item.difalDecisao?.aliquotaFcp, 0);
    assert.deepEqual(issuesDifalDoItem(item), []);
  });

  it("bloqueia com mensagem própria quando o FCP fica indeterminado", () => {
    const item = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, {
      regras: [regra({ aliquotaFcp: null })],
    });
    const issues = issuesDifalDoItem(item);

    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "NFE_DIFAL_FCP_NAO_DETERMINADO");
    assert.equal(issues[0].field, "aliquotaFcpDestino");
    assert.equal(issues[0].severidade, "BLOQUEIO");
  });
});

describe("6 e 7. especificidade da regra", () => {
  it("NCM específico vence a regra geral da UF", () => {
    const porNcm = regra({
      id: 20,
      tipoRegra: "NCM",
      ncm: NCM_PECA,
      aliquotaIcmsInterna: 12,
      aliquotaFcp: 0,
    });
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [PI_GERAL_ATUAL, porNcm]);

    assert.equal(saida.aliquotaInterna, 12);
    assert.equal(saida.origemAliquotaInterna, "REGRA_NCM");
    assert.equal(saida.regraAliquotaInterna?.regraId, 20);
  });

  it("CEST vence o NCM exato, e NCM + CEST vence os dois", () => {
    const porNcm = regra({ id: 20, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 12 });
    const porCest = regra({ id: 21, tipoRegra: "CEST", cest: CEST_PECA, aliquotaIcmsInterna: 14 });
    const porAmbos = regra({
      id: 22,
      tipoRegra: "NCM_CEST",
      ncm: NCM_PECA,
      cest: CEST_PECA,
      aliquotaIcmsInterna: 16,
    });

    const comCest = resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, cest: CEST_PECA }, [
      PI_GERAL_ATUAL,
      porNcm,
      porCest,
    ]);
    assert.equal(comCest.aliquotaInterna, 14);
    assert.equal(comCest.origemAliquotaInterna, "REGRA_CEST");

    const comAmbos = resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, cest: CEST_PECA }, [
      PI_GERAL_ATUAL,
      porNcm,
      porCest,
      porAmbos,
    ]);
    assert.equal(comAmbos.aliquotaInterna, 16);
    assert.equal(comAmbos.origemAliquotaInterna, "REGRA_NCM_CEST");
  });

  it("prefixo mais longo vence prefixo mais curto", () => {
    const curto = regra({ id: 30, tipoRegra: "NCM_PREFIXO", ncmPrefixo: "87", aliquotaIcmsInterna: 19 });
    const longo = regra({ id: 31, tipoRegra: "NCM_PREFIXO", ncmPrefixo: "8708", aliquotaIcmsInterna: 17 });
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [curto, longo]);

    assert.equal(saida.aliquotaInterna, 17);
    assert.equal(saida.regraAliquotaInterna?.regraId, 31);
  });

  it("resolve campo a campo: o NCM manda no FCP e a geral continua mandando na interna", () => {
    const soFcp = regra({
      id: 40,
      tipoRegra: "NCM",
      ncm: NCM_PECA,
      aliquotaIcmsInterna: null,
      aliquotaFcp: 2,
    });
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [PI_GERAL_ATUAL, soFcp]);

    assert.equal(saida.aliquotaInterna, 22.5);
    assert.equal(saida.origemAliquotaInterna, "REGRA_UF");
    assert.equal(saida.aliquotaFcp, 2);
    assert.equal(saida.origemFcp, "REGRA_NCM");
  });
});

describe("8. vigência escolhe a regra pela data da emissão", () => {
  it("usa a regra histórica para nota anterior à mudança", () => {
    const antes = resolverRegraDifalComRegras(
      { ...CONTEXTO_DEMIR, dataEmissao: "2025-03-31" },
      [PI_GERAL_ATUAL, PI_GERAL_ANTERIOR],
    );
    assert.equal(antes.aliquotaInterna, 21);
    assert.equal(antes.regraAliquotaInterna?.regraId, 2);
  });

  it("usa a regra nova já no primeiro dia de vigência", () => {
    const depois = resolverRegraDifalComRegras(
      { ...CONTEXTO_DEMIR, dataEmissao: "2025-04-01" },
      [PI_GERAL_ATUAL, PI_GERAL_ANTERIOR],
    );
    assert.equal(depois.aliquotaInterna, 22.5);
    assert.equal(depois.regraAliquotaInterna?.regraId, 1);
  });

  it("não aplica regra ainda não vigente", () => {
    const futura = regra({ id: 50, vigenciaInicio: "2027-01-01", aliquotaIcmsInterna: 25 });
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [PI_GERAL_ATUAL, futura]);
    assert.equal(saida.aliquotaInterna, 22.5);
  });
});

describe("9. regras conflitantes bloqueiam em vez de sortear", () => {
  it("duas regras de mesma especificidade com valores diferentes viram conflito", () => {
    const a = regra({ id: 60, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 12 });
    const b = regra({ id: 61, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 18 });
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [a, b]);

    assert.equal(saida.aliquotaInterna, null);
    assert.ok(saida.pendencias.includes("REGRA_CONFLITANTE"));
    assert.equal(saida.conflitos[0].campo, "aliquotaIcmsInterna");
    assert.deepEqual(
      saida.conflitos[0].regras.map((r) => r.id).sort(),
      [60, 61],
    );
  });

  it("não é conflito quando as duas dizem o mesmo valor", () => {
    const a = regra({ id: 62, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 12 });
    const b = regra({ id: 63, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 12 });
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [a, b]);

    assert.equal(saida.aliquotaInterna, 12);
    assert.deepEqual(saida.conflitos, []);
  });

  it("prioridade explícita desempata sem virar conflito", () => {
    const a = regra({ id: 64, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 12, prioridade: 10 });
    const b = regra({ id: 65, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 18, prioridade: 20 });
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [a, b]);

    assert.equal(saida.aliquotaInterna, 18);
    assert.deepEqual(saida.conflitos, []);
  });

  it("o bloqueio nomeia as regras em disputa", () => {
    const a = regra({ id: 60, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 12 });
    const b = regra({ id: 61, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 18 });
    const item = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, { regras: [a, b] });
    const conflito = issuesDifalDoItem(item).find(
      (issue) => issue.code === "NFE_DIFAL_REGRA_CONFLITANTE",
    );

    assert.ok(conflito);
    assert.match(conflito.message, /#60 = 12%/);
    assert.match(conflito.message, /#61 = 18%/);
  });
});

describe("10, 11 e 12. incidência do grupo (NA01-20)", () => {
  it("operação interna não gera o grupo", () => {
    const saida = resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, ufDestino: "PB" }, [PI_GERAL_ATUAL]);
    assert.equal(saida.exigeDifal, false);
    assert.equal(saida.aliquotaInterna, null);
  });

  it("destinatário contribuinte não gera o grupo", () => {
    const saida = resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, indIEDest: 1 }, [PI_GERAL_ATUAL]);
    assert.equal(saida.exigeDifal, false);
  });

  it("exceção 12: emitente do Simples Nacional (CRT 1) e MEI (CRT 4) não levam o grupo", () => {
    assert.equal(resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, crt: 1 }, [PI_GERAL_ATUAL]).exigeDifal, false);
    assert.equal(resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, crt: 4 }, [PI_GERAL_ATUAL]).exigeDifal, false);
    assert.equal(resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, crt: 3 }, [PI_GERAL_ATUAL]).exigeDifal, true);
  });

  it("exceção 10: isentas, imunes e não tributadas não levam o grupo", () => {
    for (const cst of ["40", "41"]) {
      assert.equal(deveGerarICMSUFDest({ ...CONTEXTO_ITEM, ufDestinatario: "PI", cst }), false);
    }
    for (const csosn of ["103", "300", "400"]) {
      assert.equal(deveGerarICMSUFDest({ ...CONTEXTO_ITEM, ufDestinatario: "PI", csosn }), false);
    }
  });

  it("exceção 11: complementar, ajuste, crédito e débito não levam o grupo", () => {
    for (const finNFe of [2, 3, 5, 6]) {
      assert.equal(deveGerarICMSUFDest({ ...CONTEXTO_ITEM, ufDestinatario: "PI", finNFe }), false);
    }
    assert.equal(deveGerarICMSUFDest({ ...CONTEXTO_ITEM, ufDestinatario: "PI", finNFe: 1 }), true);
  });

  it("exceção 7: entrega na UF do emitente não leva o grupo", () => {
    assert.equal(
      deveGerarICMSUFDest({ ...CONTEXTO_ITEM, ufDestinatario: "PI", ufEntrega: "PB" }),
      false,
    );
  });

  it("exceção 5: NF-e de entrada não leva o grupo", () => {
    assert.equal(deveGerarICMSUFDest({ ...CONTEXTO_ITEM, ufDestinatario: "PI", tpNF: 0 }), false);
  });

  it("NA01-10: NFC-e (modelo 65) não leva o grupo", () => {
    assert.equal(deveGerarICMSUFDest({ ...CONTEXTO_ITEM, ufDestinatario: "PI", modelo: 65 }), false);
  });

  it("exceção 9: CFOP 6.552, 6.922 e 6.929 não levam o grupo", () => {
    for (const cfop of ["6552", "6922", "6929"]) {
      assert.equal(deveGerarICMSUFDest({ ...CONTEXTO_ITEM, ufDestinatario: "PI", cfop }), false);
    }
  });
});

describe("13 e 14. alíquota interestadual pela origem da mercadoria", () => {
  it("mercadoria importada (origens 1, 2, 3 e 8) usa 4%", () => {
    for (const origem of ["1", "2", "3", "8"]) {
      const saida = resolverRegraDifalComRegras(
        { ...CONTEXTO_DEMIR, origemMercadoria: origem },
        [PI_GERAL_ATUAL],
      );
      assert.equal(saida.aliquotaInterestadual, 4, `origem ${origem}`);
    }
  });

  it("origens 6 e 7 não entram nos 4% (Resolução 13/2012, art. 1º, §4º, I)", () => {
    for (const origem of ["6", "7"]) {
      const saida = resolverRegraDifalComRegras(
        { ...CONTEXTO_DEMIR, origemMercadoria: origem },
        [PI_GERAL_ATUAL],
      );
      assert.equal(saida.aliquotaInterestadual, 12, `origem ${origem}`);
    }
  });

  it("mercadoria nacional PB → PI usa 12%", () => {
    const saida = resolverRegraDifalComRegras(
      { ...CONTEXTO_DEMIR, origemMercadoria: "0" },
      [PI_GERAL_ATUAL],
    );
    assert.equal(saida.aliquotaInterestadual, 12);
  });

  it("Sul/Sudeste exceto ES para o Nordeste usa 7%", () => {
    const saida = resolverRegraDifalComRegras(
      { ...CONTEXTO_DEMIR, ufEmitente: "SP", origemMercadoria: "0" },
      [PI_GERAL_ATUAL],
    );
    assert.equal(saida.aliquotaInterestadual, 7);
  });
});

describe("15. override manual vence a regra automática", () => {
  it("valor digitado sobrepõe a regra e a proveniência vira MANUAL", () => {
    const item = resolverDifalDoItem(
      itemDifal({
        aliquotaInternaDestino: 20,
        aliquotaFcpDestino: 1,
        overrideDifalManual: { aliquotaInterna: true, aliquotaFcp: true },
      }),
      CONTEXTO_ITEM,
      { regras: [PI_GERAL_ATUAL] },
    );

    assert.equal(item.difalDecisao?.aliquotaInterna, 20);
    assert.equal(item.difalDecisao?.origemAliquotaInterna, "MANUAL");
    assert.equal(item.difalDecisao?.aliquotaFcp, 1);
    assert.equal(item.difalDecisao?.origemFcp, "MANUAL");
    assert.deepEqual(issuesDifalDoItem(item), []);
  });

  it("valor sem marca de override NÃO vence a regra: o servidor reresolve e guarda a proveniência", () => {
    // A tela resolve o DIFAL no carregamento e devolve os mesmos números no
    // payload. Se o valor do item ganhasse, o snapshot registraria "veio do
    // ITEM" para um número que veio da regra, perdendo regraId, vigência,
    // fonte e fundamento — e o navegador passaria a ditar alíquota.
    const item = resolverDifalDoItem(
      itemDifal({ aliquotaInternaDestino: 22.5, aliquotaFcpDestino: 0 }),
      CONTEXTO_ITEM,
      { regras: [PI_GERAL_ATUAL] },
    );

    assert.equal(item.difalDecisao?.origemAliquotaInterna, "REGRA_UF");
    assert.equal(item.difalDecisao?.regraAliquotaInterna?.regraId, 1);
    assert.equal(item.difalDecisao?.origemFcp, "REGRA_UF");
    assert.equal(item.difalDecisao?.regraFcp?.fundamentoLegal, "Lei nº 8.558/2024");
    assert.deepEqual(issuesDifalDoItem(item), []);
  });

  it("valor divergente enviado pelo navegador é descartado em favor da regra", () => {
    const item = resolverDifalDoItem(
      itemDifal({ aliquotaInternaDestino: 5, aliquotaFcpDestino: 9 }),
      CONTEXTO_ITEM,
      { regras: [PI_GERAL_ATUAL] },
    );

    assert.equal(item.difalDecisao?.aliquotaInterna, 22.5);
    assert.equal(item.difalDecisao?.aliquotaFcp, 0);
    assert.equal(item.icmsUfDest?.pICMSUFDest, 22.5);
    assert.equal(item.icmsUfDest?.pFCPUFDest, 0);
  });

  it("sem nenhuma regra na UF, o valor do item ainda serve de último recurso", () => {
    // É o caminho da NF-e avulsa numa UF que ainda não tem regra cadastrada.
    const item = resolverDifalDoItem(
      itemDifal({ aliquotaInternaDestino: 20, aliquotaFcpDestino: 0 }),
      CONTEXTO_ITEM,
      { regras: [] },
    );

    assert.equal(item.difalDecisao?.aliquotaInterna, 20);
    assert.equal(item.difalDecisao?.origemAliquotaInterna, "ITEM");
    assert.equal(item.difalDecisao?.aliquotaFcp, 0);
    assert.equal(item.difalDecisao?.origemFcp, "ITEM");
    assert.deepEqual(issuesDifalDoItem(item), []);
  });
});

describe("16. o snapshot não muda quando a regra do cadastro muda", () => {
  it("alterar a regra depois não altera a decisão já gravada", () => {
    const item = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, { regras: [PI_GERAL_ATUAL] });
    const antes = JSON.parse(JSON.stringify(item.difalDecisao));
    const xmlAntes = buildIcmsUFDestXml(item.icmsUfDest!);

    // A UF publica outra alíquota e alguém atualiza o cadastro.
    const regraNova = regra({ id: 99, aliquotaIcmsInterna: 25, aliquotaFcp: 2 });
    void casarRegrasDifal([regraNova], { ufDestino: "PI", dataEmissao: "2026-09-22" });

    assert.deepEqual(JSON.parse(JSON.stringify(item.difalDecisao)), antes);
    assert.equal(buildIcmsUFDestXml(item.icmsUfDest!), xmlAntes);
    assert.equal(item.difalDecisao?.aliquotaInterna, 22.5);
  });
});

describe("17. mudança de contexto exige nova resolução", () => {
  it("trocar a UF de destino muda a regra escolhida", () => {
    const rj = regra({ id: 70, uf: "RJ", aliquotaIcmsInterna: 18, aliquotaFcp: 2 });
    const paraPi = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, {
      regras: [PI_GERAL_ATUAL, rj],
    });
    const paraRj = resolverDifalDoItem(
      itemDifal(),
      { ...CONTEXTO_ITEM, ufDestinatario: "RJ" },
      { regras: [PI_GERAL_ATUAL, rj] },
    );

    assert.equal(paraPi.difalDecisao?.aliquotaInterna, 22.5);
    assert.equal(paraRj.difalDecisao?.aliquotaInterna, 18);
    assert.equal(paraRj.difalDecisao?.aliquotaFcp, 2);
  });

  it("o snapshot guarda o contexto em que foi decidido", () => {
    const item = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, { regras: [PI_GERAL_ATUAL] });

    assert.equal(item.difalDecisao?.contexto.ufDestino, "PI");
    assert.equal(item.difalDecisao?.contexto.crt, "3");
    assert.equal(item.difalDecisao?.contexto.modelo, "55");
    assert.equal(item.difalDecisao?.dataResolucao, "2026-09-22");
  });

  it("trocar o NCM muda a regra escolhida", () => {
    const porNcm = regra({ id: 71, tipoRegra: "NCM", ncm: "84212300", aliquotaIcmsInterna: 12 });
    const comOutroNcm = resolverDifalDoItem(itemDifal({ ncm: "84212300" }), CONTEXTO_ITEM, {
      regras: [PI_GERAL_ATUAL, porNcm],
    });
    const comNcmDaPeca = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, {
      regras: [PI_GERAL_ATUAL, porNcm],
    });

    assert.equal(comOutroNcm.difalDecisao?.aliquotaInterna, 12);
    assert.equal(comNcmDaPeca.difalDecisao?.aliquotaInterna, 22.5);
  });
});

describe("contexto sem data: a regressão da validação local", () => {
  it("sem data de emissão não há vigência para comparar, e o motor bloqueia", () => {
    const { dataEmissao, ...semData } = CONTEXTO_ITEM;
    void dataEmissao;
    const item = resolverDifalDoItem(itemDifal(), semData, { regras: [PI_GERAL_ATUAL] });

    assert.ok(item.difalDecisao?.pendencias.includes("CONTEXTO_INCOMPLETO"));
    assert.equal(item.difalDecisao?.aliquotaInterna, 22.5, "cai na tabela de referência");
    assert.equal(item.difalDecisao?.origemAliquotaInterna, "TABELA_REFERENCIA");
  });

  it("o bloqueio diz qual peça falta, em vez de 'a UF ou a data'", () => {
    const { dataEmissao, ...semData } = CONTEXTO_ITEM;
    void dataEmissao;
    const item = resolverDifalDoItem(itemDifal(), semData, { regras: [PI_GERAL_ATUAL] });
    const issue = issuesDifalDoItem(item).find(
      (i) => i.code === "NFE_DIFAL_CONTEXTO_INCOMPLETO",
    );

    assert.ok(issue);
    assert.match(issue.message, /Falta a data de emissão\./);
    assert.ok(!/UF de destino/.test(issue.message), "a UF está presente, não pode ser citada");
  });

  it("com a mesma data que o servidor usou, a validação local fecha sem pendência", () => {
    const item = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, { regras: [PI_GERAL_ATUAL] });

    assert.deepEqual(item.difalDecisao?.pendencias, []);
    assert.equal(item.difalDecisao?.origemAliquotaInterna, "REGRA_UF");
    assert.deepEqual(issuesDifalDoItem(item), []);
  });
});

describe("18. ausência de regra não vira chute", () => {
  it("UF sem nenhuma regra cadastrada bloqueia em vez de inventar alíquota", () => {
    const saida = resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, ufDestino: "MA" }, []);

    assert.equal(saida.exigeDifal, true);
    assert.equal(saida.aliquotaInterna, null);
    assert.equal(saida.aliquotaFcp, null);
    assert.ok(saida.pendencias.includes("ALIQUOTA_INTERNA_NAO_DETERMINADA"));
    assert.ok(saida.pendencias.includes("FCP_NAO_DETERMINADO"));
  });

  it("regra desativada não resolve nada", () => {
    const desativada = regra({ ativo: false });
    const saida = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [desativada]);

    assert.equal(saida.aliquotaInterna, null);
    assert.ok(saida.pendencias.includes("ALIQUOTA_INTERNA_NAO_DETERMINADA"));
  });

  it("NCM ausente ou inválido bloqueia, porque nenhuma regra por mercadoria pode ser avaliada", () => {
    const semNcm = resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, ncm: "PC-4471" }, [PI_GERAL_ATUAL]);
    assert.ok(semNcm.pendencias.includes("NCM_INVALIDO"));
    assert.equal(semNcm.resolvidoAutomaticamente, false);
  });

  it("NCM com 8 dígitos que não existe na NCM oficial bloqueia", () => {
    // 22346792 é o que está no cadastro do "MÓDULO VOLVO 6792" da venda #180:
    // o final é o código da peça. Passa no formato e não existe na NCM.
    const inexistente = resolverRegraDifalComRegras(
      { ...CONTEXTO_DEMIR, ncm: "22346792" },
      [PI_GERAL_ATUAL],
      { ncmConhecido: false },
    );

    assert.ok(inexistente.pendencias.includes("NCM_INEXISTENTE"));
    assert.equal(inexistente.resolvidoAutomaticamente, false);
  });

  it("NCM existente no catálogo não levanta pendência", () => {
    const valido = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [PI_GERAL_ATUAL], {
      ncmConhecido: true,
    });

    assert.ok(!valido.pendencias.includes("NCM_INEXISTENTE"));
    assert.equal(valido.resolvidoAutomaticamente, true);
  });

  it("catálogo não importado desliga a checagem em vez de travar toda emissão", () => {
    const semCatalogo = resolverRegraDifalComRegras({ ...CONTEXTO_DEMIR, ncm: "22346792" }, [
      PI_GERAL_ATUAL,
    ]);

    assert.ok(!semCatalogo.pendencias.includes("NCM_INEXISTENTE"));
    assert.equal(semCatalogo.resolvidoAutomaticamente, true);
  });

  it("o bloqueio do NCM inexistente chega ao item com mensagem própria", () => {
    const item = resolverDifalDoItem(itemDifal({ ncm: "22346792" }), CONTEXTO_ITEM, {
      regras: [PI_GERAL_ATUAL],
      ncmConhecido: false,
    });
    const issue = issuesDifalDoItem(item).find((i) => i.code === "NFE_DIFAL_NCM_INEXISTENTE");

    assert.ok(issue);
    assert.equal(issue.field, "ncm");
    assert.equal(issue.severidade, "BLOQUEIO");
  });

  it("o NCM inexistente bloqueia mesmo com as alíquotas já preenchidas pela tela", () => {
    // O item chega do navegador com tudo resolvido e sem pendência aparente.
    // Quem reconfere o catálogo é o servidor, e ele barra assim mesmo.
    const item = resolverDifalDoItem(
      itemDifal({ ncm: "22346792", aliquotaInternaDestino: 22.5, aliquotaFcpDestino: 0 }),
      CONTEXTO_ITEM,
      { regras: [PI_GERAL_ATUAL], ncmConhecido: false },
    );

    assert.equal(item.difalDecisao?.aliquotaInterna, 22.5);
    assert.ok(
      issuesDifalDoItem(item).some((i) => i.code === "NFE_DIFAL_NCM_INEXISTENTE"),
      "o bloqueio não pode depender de a tela ter deixado campo vazio",
    );
  });

  it("o fallback da tabela genérica é marcado e continua bloqueando", () => {
    const item = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, { regras: [] });

    assert.equal(item.difalDecisao?.origemAliquotaInterna, "TABELA_REFERENCIA");
    const issue = issuesDifalDoItem(item).find(
      (i) => i.code === "NFE_DIFAL_ALIQUOTA_INTERNA_SEM_REGRA",
    );
    assert.ok(issue, "fallback de tabela tem de bloquear");
  });
});

describe("19. serialização do zero entre tela e servidor", () => {
  it('"0" do formulário não some no caminho até virar 0', () => {
    // O mesmo encadeamento das telas: `campo || null` e depois a conversão.
    const paraApi = (texto: string) => texto || null;
    const paraNumero = (valor: string | null) =>
      valor === null || valor.trim() === "" ? null : Number(valor);

    assert.equal(paraApi("0"), "0", '"0" é truthy: não pode virar null');
    assert.equal(paraNumero(paraApi("0")), 0);
    assert.notEqual(paraNumero(paraApi("0")), null);

    assert.equal(paraApi(""), null, "campo em branco continua sendo ausência");
    assert.equal(paraNumero(paraApi("")), null);
  });

  it("FCP 0 informado pela tela chega ao snapshot como zero, não como ausente", () => {
    const item = resolverDifalDoItem(itemDifal({ aliquotaFcpDestino: 0 }), CONTEXTO_ITEM, {
      regras: [regra({ aliquotaFcp: null })],
    });

    assert.equal(item.difalDecisao?.aliquotaFcp, 0);
    assert.equal(item.icmsUfDest?.pFCPUFDest, 0);
    assert.ok(!issuesDifalDoItem(item).some((i) => i.code === "NFE_DIFAL_FCP_NAO_DETERMINADO"));
  });

  it("regra com FCP 0 e regra sem FCP produzem decisões diferentes", () => {
    const comZero = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [regra({ aliquotaFcp: 0 })]);
    const semNada = resolverRegraDifalComRegras(CONTEXTO_DEMIR, [regra({ aliquotaFcp: null })]);

    assert.equal(comZero.aliquotaFcp, 0);
    assert.equal(semNada.aliquotaFcp, null);
    assert.notEqual(comZero.resolvidoAutomaticamente, semNada.resolvidoAutomaticamente);
  });
});

describe("20. o grupo ICMSUFDest do XML", () => {
  it("monta os nove campos a partir do snapshot resolvido", () => {
    const item = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, { regras: [PI_GERAL_ATUAL] });
    const grupo = item.icmsUfDest;

    assert.ok(grupo);
    assert.equal(grupo.vBCUFDest, 7500);
    assert.equal(grupo.vBCFCPUFDest, 7500);
    assert.equal(grupo.pFCPUFDest, 0);
    assert.equal(grupo.pICMSUFDest, 22.5);
    assert.equal(grupo.pICMSInter, 12);
    assert.equal(grupo.pICMSInterPart, 100);
    assert.equal(grupo.vFCPUFDest, 0);
    // (22,5% - 12%) de 7.500 = 787,50, 100% para o destino.
    assert.equal(grupo.vICMSUFDest, 787.5);
    assert.equal(grupo.vICMSUFRemet, 0);
  });

  it("serializa na ordem do leiaute 4.00", () => {
    const item = resolverDifalDoItem(itemDifal(), CONTEXTO_ITEM, { regras: [PI_GERAL_ATUAL] });
    assert.equal(
      buildIcmsUFDestXml(item.icmsUfDest!),
      "<ICMSUFDest>" +
        "<vBCUFDest>7500.00</vBCUFDest>" +
        "<vBCFCPUFDest>7500.00</vBCFCPUFDest>" +
        "<pFCPUFDest>0.00</pFCPUFDest>" +
        "<pICMSUFDest>22.50</pICMSUFDest>" +
        "<pICMSInter>12.00</pICMSInter>" +
        "<pICMSInterPart>100.00</pICMSInterPart>" +
        "<vFCPUFDest>0.00</vFCPUFDest>" +
        "<vICMSUFDest>787.50</vICMSUFDest>" +
        "<vICMSUFRemet>0.00</vICMSUFRemet>" +
        "</ICMSUFDest>",
    );
  });

  it("FCP maior que zero entra no grupo com base e valor", () => {
    const rj = regra({ id: 80, uf: "RJ", aliquotaIcmsInterna: 18, aliquotaFcp: 2 });
    const item = resolverDifalDoItem(
      itemDifal(),
      { ...CONTEXTO_ITEM, ufDestinatario: "RJ" },
      { regras: [rj] },
    );

    assert.equal(item.icmsUfDest?.pFCPUFDest, 2);
    assert.equal(item.icmsUfDest?.vFCPUFDest, 150);
    assert.equal(item.icmsUfDest?.vICMSUFDest, 450);
  });

  it("a base do DIFAL segue a composição do ICMS próprio, inclusive quanto ao frete", () => {
    // O motor usa icmsDecisao.composicaoBase.baseIcmsProprio quando ela existe.
    // É a mesma que o resumo da tela mostra: repetir a fórmula na interface
    // faria o número exibido divergir do imposto assim que houvesse frete.
    const comFreteNaBase = resolverDifalDoItem(
      itemDifal({
        valorFrete: 500,
        icmsDecisao: { composicaoBase: { baseIcmsProprio: 8000 } },
      } as Partial<NFeItem>),
      CONTEXTO_ITEM,
      { regras: [PI_GERAL_ATUAL] },
    );
    assert.equal(comFreteNaBase.icmsUfDest?.vBCUFDest, 8000);
    // (22,5% - 12%) de 8.000 = 840,00
    assert.equal(comFreteNaBase.icmsUfDest?.vICMSUFDest, 840);

    const semComposicao = resolverDifalDoItem(
      itemDifal({ valorFrete: 500 }),
      CONTEXTO_ITEM,
      { regras: [PI_GERAL_ATUAL] },
    );
    // Sem composição gravada, o motor cai em valorTotal - desconto + frete.
    assert.equal(semComposicao.icmsUfDest?.vBCUFDest, 8000);
  });

  it("operação sem DIFAL não recebe o grupo", () => {
    const item = resolverDifalDoItem(itemDifal(), { ...CONTEXTO_ITEM, ufDestinatario: "PB" }, {
      regras: [PI_GERAL_ATUAL],
    });
    assert.equal(item.icmsUfDest, undefined);
    assert.equal(item.difalDecisao, undefined);
  });
});

describe("casamento de regras: detalhes do núcleo", () => {
  it("regra de outra UF nunca casa", () => {
    const resultado = casarRegrasDifal([regra({ uf: "RJ" })], {
      ufDestino: "PI",
      dataEmissao: "2026-09-22",
    });
    assert.equal(resultado.aliquotaInterna, null);
    assert.deepEqual(resultado.candidatas, []);
  });

  it("NCM com pontuação é normalizado antes de comparar", () => {
    const porNcm = regra({ id: 90, tipoRegra: "NCM", ncm: NCM_PECA, aliquotaIcmsInterna: 12 });
    const resultado = casarRegrasDifal([porNcm], {
      ufDestino: "PI",
      dataEmissao: "2026-09-22",
      ncm: "8708.99.90",
    });
    assert.equal(resultado.aliquotaInterna?.valor, 12);
  });

  it("data inválida não casa nada, em vez de cair na regra mais recente", () => {
    const resultado = casarRegrasDifal([PI_GERAL_ATUAL], { ufDestino: "PI", dataEmissao: "" });
    assert.equal(resultado.aliquotaInterna, null);
    assert.deepEqual(resultado.candidatas, []);
  });
});
