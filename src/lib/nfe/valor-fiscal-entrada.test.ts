import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lerItensDaNota, lerNFeDoXml, lerTotaisDaNota } from "./totais-nfe";
import type { ItemFiscalDaNota, TotaisDaNota } from "./totais-nfe";
import {
  calcularValorFiscalDaEntrada,
  componentesDoItem,
  componentesForaDoCusto,
  componentesNaoAlocados,
  type LinhaDestinada,
} from "./valor-fiscal-entrada";

/* ------------------------------------------------------------------ *
 * Fixtures — o mesmo XML de ponta a ponta, como a rota de entrada faz.
 * ------------------------------------------------------------------ */

type Campos = Record<string, string | number | undefined>;

function tags(campos: Campos = {}): string {
  return Object.entries(campos)
    .filter(([, valor]) => valor !== undefined)
    .map(([nome, valor]) => `<${nome}>${valor}</${nome}>`)
    .join("");
}

function item(
  opcoes: {
    nItem?: number;
    prod?: Campos;
    icms?: { grupo: string; campos: Campos };
    ipi?: Campos;
    ii?: Campos;
    pisST?: Campos;
    cofinsST?: Campos;
    pis?: Campos;
    cofins?: Campos;
    impostoDevol?: Campos;
    vTotTrib?: number | string;
  } = {},
): string {
  const prod = {
    cProd: "PC-1",
    cEAN: "SEM GTIN",
    xProd: "Peca",
    NCM: "87083090",
    CFOP: "5102",
    uCom: "UN",
    qCom: "1.0000",
    vUnCom: "100.00",
    vProd: "100.00",
    indTot: 1,
    ...opcoes.prod,
  };

  const icms = opcoes.icms
    ? `<ICMS><${opcoes.icms.grupo}>${tags(opcoes.icms.campos)}</${opcoes.icms.grupo}></ICMS>`
    : "<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>";

  const imposto = [
    opcoes.vTotTrib !== undefined ? `<vTotTrib>${opcoes.vTotTrib}</vTotTrib>` : "",
    icms,
    opcoes.ipi ? `<IPI><cEnq>999</cEnq><IPITrib>${tags(opcoes.ipi)}</IPITrib></IPI>` : "",
    opcoes.ii ? `<II>${tags(opcoes.ii)}</II>` : "",
    opcoes.pis ? `<PIS><PISAliq>${tags(opcoes.pis)}</PISAliq></PIS>` : "",
    opcoes.pisST ? `<PISST>${tags(opcoes.pisST)}</PISST>` : "",
    opcoes.cofins ? `<COFINS><COFINSAliq>${tags(opcoes.cofins)}</COFINSAliq></COFINS>` : "",
    opcoes.cofinsST ? `<COFINSST>${tags(opcoes.cofinsST)}</COFINSST>` : "",
  ].join("");

  const devol = opcoes.impostoDevol
    ? `<impostoDevol><pDevol>100.00</pDevol><IPI>${tags(opcoes.impostoDevol)}</IPI></impostoDevol>`
    : "";

  return `<det nItem="${opcoes.nItem ?? 1}"><prod>${tags(prod)}</prod><imposto>${imposto}</imposto>${devol}</det>`;
}

function montarXml(
  opcoes: {
    ide?: Campos;
    icmsTot?: Campos;
    issqnTot?: Campos;
    totalExtra?: string;
    itens?: string[];
  } = {},
): string {
  const ide = {
    cUF: 25,
    mod: 55,
    serie: 1,
    nNF: 1234,
    dhEmi: "2026-08-25T09:00:00-03:00",
    tpNF: 1,
    ...opcoes.ide,
  };
  const icmsTot = { vProd: "100.00", vNF: "100.00", ...opcoes.icmsTot };

  const total = [
    `<ICMSTot>${tags(icmsTot)}</ICMSTot>`,
    opcoes.issqnTot ? `<ISSQNtot>${tags(opcoes.issqnTot)}</ISSQNtot>` : "",
    opcoes.totalExtra ?? "",
  ].join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe>` +
    `<infNFe Id="NFe25260812345678000199550010000012341000012348" versao="4.00">` +
    `<ide>${tags(ide)}</ide>` +
    `<emit><CNPJ>12345678000199</CNPJ><xNome>Fornecedor</xNome></emit>` +
    `<dest><CNPJ>98765432000188</CNPJ><xNome>Oficina</xNome></dest>` +
    (opcoes.itens ?? [item()]).join("") +
    `<total>${total}</total>` +
    `</infNFe></NFe></nfeProc>`
  );
}

function ler(xml: string): { totais: TotaisDaNota; itens: ItemFiscalDaNota[] } {
  const { infNFe } = lerNFeDoXml(xml);
  assert.ok(infNFe);
  return { totais: lerTotaisDaNota(infNFe), itens: lerItensDaNota(infNFe) };
}

/** Destina a nota inteira, que é o que a tela faz hoje. */
function destinarTudo(xml: string) {
  const { totais, itens } = ler(xml);
  const destinadas: LinhaDestinada[] = itens.map((i) => ({ numeroItem: i.numeroItem }));
  return calcularValorFiscalDaEntrada(totais, itens, destinadas);
}

/** Valor fiscal de uma nota de um item só, destinada inteira. */
function fiscalDeUmItem(icmsTot: Campos, itemXml?: string): number {
  return destinarTudo(montarXml({ icmsTot, itens: itemXml ? [itemXml] : undefined }))
    .valorFiscalDestinado;
}

/* ------------------------------------------------------------------ *
 * 1 a 6 — a fórmula antiga já dava conta destes
 * ------------------------------------------------------------------ */

describe("componentes que a formula antiga ja conhecia", () => {
  it("1. somente vProd", () => {
    assert.equal(fiscalDeUmItem({ vProd: "100.00", vNF: "100.00" }), 100);
  });

  it("2. produto + desconto", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vDesc: "10.00", vNF: "90.00" },
        item({ prod: { vDesc: "10.00" } }),
      ),
      90,
    );
  });

  it("3. produto + frete", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vFrete: "25.50", vNF: "125.50" },
        item({ prod: { vFrete: "25.50" } }),
      ),
      125.5,
    );
  });

  it("4. produto + seguro", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vSeg: "7.35", vNF: "107.35" },
        item({ prod: { vSeg: "7.35" } }),
      ),
      107.35,
    );
  });

  it("5. produto + outras despesas", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vOutro: "42.90", vNF: "142.90" },
        item({ prod: { vOutro: "42.90" } }),
      ),
      142.9,
    );
  });

  it("6. produto + IPI", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vIPI: "5.00", vNF: "105.00" },
        item({ ipi: { vIPI: "5.00" } }),
      ),
      105,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 7 a 14 — os que a fórmula antiga deixava de fora
 * ------------------------------------------------------------------ */

describe("componentes vinculados ao item que a formula antiga ignorava", () => {
  const comIcms = (campos: Campos, grupo = "ICMS10") =>
    item({ icms: { grupo, campos: { orig: 0, ...campos } } });

  it("7. ICMS-ST vinculado ao item entra no valor fiscal", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vST: "22.00", vNF: "122.00" },
        comIcms({ CST: 10, vICMSST: "22.00" }),
      ),
      122,
    );
  });

  it("8. FCP-ST vinculado ao item entra no valor fiscal", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vST: "20.00", vFCPST: "2.60", vNF: "122.60" },
        comIcms({ CST: 10, vICMSST: "20.00", vFCPST: "2.60" }),
      ),
      122.6,
    );
  });

  it("9. imposto de importacao vinculado ao item entra no valor fiscal", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vII: "18.00", vNF: "118.00" },
        item({ prod: { CFOP: "3102" }, ii: { vII: "18.00" } }),
      ),
      118,
    );
  });

  it("10. IPI devolvido vinculado ao item entra no valor fiscal", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vIPIDevol: "8.00", vNF: "108.00" },
        item({ impostoDevol: { vIPIDevol: "8.00" } }),
      ),
      108,
    );
  });

  it("11. PIS-ST com indSomaPISST=1 entra; com 0 nao entra", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vNF: "112.00" },
        item({ pisST: { vPIS: "12.00", indSomaPISST: 1 } }),
      ),
      112,
    );
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vNF: "100.00" },
        item({ pisST: { vPIS: "12.00", indSomaPISST: 0 } }),
      ),
      100,
    );
  });

  it("12. COFINS-ST com indSomaCOFINSST=1 entra no valor fiscal", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vNF: "124.00" },
        item({ cofinsST: { vCOFINS: "24.00", indSomaCOFINSST: 1 } }),
      ),
      124,
    );
  });

  it("13. ICMS desonerado vinculado ao item reduz o valor fiscal", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "800.00", vICMSDeson: "80.00", vNF: "720.00" },
        comIcms({ CST: 40, vICMSDeson: "80.00", motDesICMS: 9 }, "ICMS40"),
      ),
      720,
    );
  });

  it("14. ICMS monofasico retido vinculado ao item entra no valor fiscal", () => {
    assert.equal(
      fiscalDeUmItem(
        { vProd: "100.00", vICMSMonoReten: "15.00", vNF: "115.00" },
        comIcms({ CST: 61, vICMSMonoReten: "15.00" }, "ICMS61"),
      ),
      115,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 15 a 17 — total sem alocação, conciliação parcial, tudo junto
 * ------------------------------------------------------------------ */

describe("valores existentes somente no total da NF-e", () => {
  it("15. componente so no total e rateado, e nao some do valor fiscal", () => {
    const entrada = destinarTudo(
      montarXml({
        icmsTot: { vProd: "200.00", vICMSMonoReten: "15.00", vNF: "215.00" },
        itens: [
          item({ nItem: 1, prod: { vUnCom: "100.00", vProd: "100.00" } }),
          item({ nItem: 2, prod: { vUnCom: "100.00", vProd: "100.00" } }),
        ],
      }),
    );

    assert.equal(entrada.naoAlocados.length, 1);
    assert.equal(entrada.naoAlocados[0].tipo, "ICMS_MONO_RETEN");
    assert.equal(entrada.naoAlocados[0].origem, "TOTAL_NFE");
    // 15,00 sobre dois itens iguais: 7,50 cada, e a soma fecha no vNF.
    assert.deepEqual(
      entrada.linhas.map((linha) => linha.cotaNaoAlocada),
      [7.5, 7.5],
    );
    assert.equal(entrada.valorFiscalDestinado, 215);
    assert.equal(entrada.diferencaParaONota, 0);
  });

  it("15b. rateio com residuo de centavo fecha exatamente no total", () => {
    const entrada = destinarTudo(
      montarXml({
        icmsTot: { vProd: "300.00", vOutro: "10.00", vNF: "310.00" },
        itens: [
          item({ nItem: 1, prod: { vUnCom: "100.00", vProd: "100.00" } }),
          item({ nItem: 2, prod: { vUnCom: "100.00", vProd: "100.00" } }),
          item({ nItem: 3, prod: { vUnCom: "100.00", vProd: "100.00" } }),
        ],
      }),
    );

    const cotas = entrada.linhas.map((linha) => linha.cotaNaoAlocada);
    assert.equal(cotas.reduce((soma, cota) => soma + Math.round(cota * 100), 0), 1000);
    assert.equal(entrada.valorFiscalDestinado, 310);
    assert.equal(entrada.diferencaParaONota, 0);
  });

  it("16. componente parcialmente conciliado: so a sobra e rateada", () => {
    const entrada = destinarTudo(
      montarXml({
        icmsTot: { vProd: "100.00", vFrete: "30.00", vNF: "130.00" },
        itens: [item({ prod: { vFrete: "18.00" } })],
      }),
    );

    const frete = entrada.naoAlocados.find((parte) => parte.tipo === "FRETE");
    assert.ok(frete);
    assert.equal(frete.valor, 12);
    assert.equal(entrada.linhas[0].valorFiscalDoItem, 118);
    assert.equal(entrada.linhas[0].cotaNaoAlocada, 12);
    assert.equal(entrada.valorFiscalDestinado, 130);
  });

  it("17. varios componentes simultaneamente fecham no vNF", () => {
    const entrada = destinarTudo(
      montarXml({
        icmsTot: {
          vProd: "1000.00",
          vDesc: "50.00",
          vFrete: "80.00",
          vSeg: "20.00",
          vOutro: "30.00",
          vST: "150.00",
          vFCPST: "10.00",
          vII: "25.00",
          vIPI: "100.00",
          vIPIDevol: "5.00",
          vNF: "1370.00",
        },
        itens: [
          item({
            prod: {
              vUnCom: "1000.00",
              vProd: "1000.00",
              vDesc: "50.00",
              vFrete: "80.00",
              vSeg: "20.00",
              vOutro: "30.00",
              CFOP: "3102",
            },
            icms: {
              grupo: "ICMS10",
              campos: { orig: 0, CST: 10, vICMSST: "150.00", vFCPST: "10.00" },
            },
            ipi: { vIPI: "100.00" },
            ii: { vII: "25.00" },
            impostoDevol: { vIPIDevol: "5.00" },
          }),
        ],
      }),
    );

    assert.equal(entrada.valorFiscalDestinado, 1370);
    assert.equal(entrada.diferencaParaONota, 0);
    assert.deepEqual(entrada.naoAlocados, []);
  });
});

/* ------------------------------------------------------------------ *
 * 18 a 21 e 30 — destinação total, parcial e proporcional
 * ------------------------------------------------------------------ */

describe("destinacao total, parcial e proporcional", () => {
  const notaDeTresItens = () =>
    montarXml({
      icmsTot: { vProd: "600.00", vST: "60.00", vNF: "660.00" },
      itens: [1, 2, 3].map((nItem) =>
        item({
          nItem,
          prod: { qCom: "2.0000", vUnCom: "100.00", vProd: "200.00" },
          icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "20.00" } },
        }),
      ),
    });

  it("18. todos os itens destinados: valor fiscal e o vNF", () => {
    const entrada = destinarTudo(notaDeTresItens());
    assert.equal(entrada.notaInteira, true);
    assert.equal(entrada.valorFiscalDestinado, 660);
    assert.equal(entrada.totalDaNota, 660);
    assert.equal(entrada.diferencaParaONota, 0);
  });

  it("19. so parte dos itens destinada: leva o valor fiscal daqueles itens", () => {
    const { totais, itens } = ler(notaDeTresItens());
    const entrada = calcularValorFiscalDaEntrada(totais, itens, [{ numeroItem: 1 }]);

    assert.equal(entrada.notaInteira, false);
    assert.equal(entrada.valorFiscalDestinado, 220);
    // O vNF inteiro NÃO é reaproveitado numa entrada parcial.
    assert.notEqual(entrada.valorFiscalDestinado, entrada.totalDaNota);
  });

  it("20. quantidade parcialmente destinada leva a fracao do valor fiscal", () => {
    const { totais, itens } = ler(notaDeTresItens());
    const entrada = calcularValorFiscalDaEntrada(totais, itens, [
      { numeroItem: 1, quantidadeDestinada: 1 },
    ]);

    const linha = entrada.linhas[0];
    assert.equal(linha.quantidadeDoItem, 2);
    assert.equal(linha.quantidadeDestinada, 1);
    assert.equal(linha.proporcao, 0.5);
    // Metade de 220,00: produto 100,00 + metade do ST do item.
    assert.equal(linha.valorFiscalDoItem, 110);
    assert.equal(entrada.valorFiscalDestinado, 110);
  });

  it("21. NF-e ja parcialmente destinada: a segunda entrada leva o resto", () => {
    const { totais, itens } = ler(notaDeTresItens());

    const primeira = calcularValorFiscalDaEntrada(totais, itens, [{ numeroItem: 1 }]);
    const segunda = calcularValorFiscalDaEntrada(totais, itens, [
      { numeroItem: 2 },
      { numeroItem: 3 },
    ]);

    assert.equal(primeira.valorFiscalDestinado, 220);
    assert.equal(segunda.valorFiscalDestinado, 440);
    // Nada se perde e nada se repete entre as duas entradas.
    assert.equal(
      primeira.valorFiscalDestinado + segunda.valorFiscalDestinado,
      totais.totalNota,
    );
  });

  it("30. arredondamento proporcional nao inventa nem perde centavo", () => {
    const { totais, itens } = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.01", vOutro: "0.01" },
        itens: [item({ prod: { qCom: "3.0000", vUnCom: "33.3333", vProd: "100.00" } })],
      }),
    );

    const umTerco = calcularValorFiscalDaEntrada(totais, itens, [
      { numeroItem: 1, quantidadeDestinada: 1 },
    ]);
    // 100,00 / 3 arredonda para 33,33 — nunca 33,3333 nem NaN.
    assert.equal(umTerco.linhas[0].valorFiscalDoItem, 33.33);
    assert.equal(Number.isFinite(umTerco.valorFiscalDestinado), true);
  });

  it("quantidade zero no XML nao gera NaN: o item vai inteiro", () => {
    const { totais, itens } = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        itens: [item({ prod: { qCom: "0", vUnCom: "0", vProd: "100.00" } })],
      }),
    );
    const entrada = calcularValorFiscalDaEntrada(totais, itens, [{ numeroItem: 1 }]);

    assert.equal(entrada.linhas[0].proporcao, 1);
    assert.equal(entrada.valorFiscalDestinado, 100);
  });
});

/* ------------------------------------------------------------------ *
 * 22 a 25 — nada de dupla contagem, nada de imposto somado por existir
 * ------------------------------------------------------------------ */

describe("nada e somado duas vezes nem por existir no XML", () => {
  it("22. ST no item e em ICMSTot conta uma vez so", () => {
    const entrada = destinarTudo(
      montarXml({
        icmsTot: { vProd: "100.00", vST: "22.00", vNF: "122.00" },
        itens: [
          item({
            icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "22.00" } },
          }),
        ],
      }),
    );

    // Somar item + total daria 144,00.
    assert.equal(entrada.valorFiscalDestinado, 122);
    assert.deepEqual(entrada.naoAlocados, []);
  });

  it("23. imposto informativo presente nao altera o valor fiscal", () => {
    const entrada = destinarTudo(
      montarXml({
        icmsTot: {
          vProd: "100.00",
          vBC: "100.00",
          vICMS: "18.00",
          vPIS: "1.65",
          vCOFINS: "7.60",
          vTotTrib: "27.25",
          vNF: "100.00",
        },
        itens: [
          item({
            vTotTrib: "27.25",
            icms: { grupo: "ICMS00", campos: { orig: 0, CST: "00", vICMS: "18.00" } },
            pis: { CST: "01", vPIS: "1.65" },
            cofins: { CST: "01", vCOFINS: "7.60" },
          }),
        ],
      }),
    );

    assert.equal(entrada.valorFiscalDestinado, 100);

    // Foram lidos e marcados, não descartados: a tela pode mostrá-los.
    const componentes = entrada.linhas[0].componentes;
    const icms = componentes.find((parte) => parte.tipo === "ICMS_PROPRIO");
    assert.ok(icms);
    assert.equal(icms.valor, 18);
    assert.equal(icms.compoeValorNFe, false);
    assert.equal(icms.sinalFiscal, 0);
    assert.equal(icms.tratamentoCusto, "INFORMATIVO");
  });

  it("24. o ICMS proprio nao vira acrescimo: 334,00 + 124,34 = 458,34", () => {
    // A NF-e real de regressao: um item, CST 10, ST do proprio item.
    const entrada = destinarTudo(
      montarXml({
        icmsTot: {
          vBC: "334.00",
          vICMS: "13.36",
          vBCST: "424.00",
          vST: "124.34",
          vProd: "334.00",
          vNF: "458.34",
        },
        itens: [
          item({
            prod: {
              cProd: "RACOR-1",
              xProd: "FILTRO RACOR BLINDADO",
              vUnCom: "334.00",
              vProd: "334.00",
            },
            icms: {
              grupo: "ICMS10",
              campos: {
                orig: 0,
                CST: 10,
                vBC: "334.00",
                vICMS: "13.36",
                vBCST: "424.00",
                vICMSST: "124.34",
              },
            },
          }),
        ],
      }),
    );

    assert.equal(entrada.linhas.length, 1);
    assert.equal(entrada.linhas[0].valorFiscal, 458.34);
    assert.equal(entrada.valorFiscalDestinado, 458.34);
    assert.equal(entrada.totalDaNota, 458.34);
    assert.equal(entrada.diferencaParaONota, 0);
    // Nada para lançar à parte.
    assert.deepEqual(entrada.naoAlocados, []);
    // E o ICMS próprio de 13,36 continua fora: 334 + 124,34 + 13,36 seria 471,70.
    assert.notEqual(entrada.valorFiscalDestinado, 471.7);
  });

  it("25. IBS e CBS de 2026 nao entram no valor fiscal nem se perdem", () => {
    const entrada = destinarTudo(
      montarXml({
        ide: { dhEmi: "2026-07-15T10:00:00-03:00" },
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        totalExtra:
          "<ISTot><vIS>3.00</vIS></ISTot>" +
          "<IBSCBSTot><vBCIBSCBS>100.00</vBCIBSCBS>" +
          "<gIBS><vIBS>10.00</vIBS></gIBS><gCBS><vCBS>9.00</vCBS></gCBS></IBSCBSTot>",
      }),
    );

    assert.equal(entrada.valorFiscalDestinado, 100);
    assert.equal(entrada.diferencaParaONota, 0);
  });
});

/* ------------------------------------------------------------------ *
 * 26 a 29 — valor fiscal não é custo de estoque
 * ------------------------------------------------------------------ */

describe("valor fiscal e custo de estoque sao respostas diferentes", () => {
  const notaComST = () =>
    montarXml({
      icmsTot: { vProd: "100.00", vST: "22.00", vNF: "122.00" },
      itens: [
        item({
          icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "22.00" } },
        }),
      ],
    });

  it("26. valor fiscal 122,00 com custo de estoque 100,00 na mesma linha", () => {
    const entrada = destinarTudo(notaComST());

    assert.equal(entrada.valorFiscalDestinado, 122);
    assert.equal(entrada.custoEstoqueDestinado, 100);
    assert.equal(entrada.linhas[0].valorFiscal, 122);
    assert.equal(entrada.linhas[0].custoEstoque, 100);
  });

  it("27. tributo que a politica integra soma no custo", () => {
    const entrada = destinarTudo(
      montarXml({
        icmsTot: { vProd: "100.00", vIPI: "5.00", vFrete: "10.00", vNF: "115.00" },
        itens: [item({ prod: { vFrete: "10.00" }, ipi: { vIPI: "5.00" } })],
      }),
    );

    assert.equal(entrada.valorFiscalDestinado, 115);
    assert.equal(entrada.custoEstoqueDestinado, 115);
    const ipi = entrada.linhas[0].componentes.find((parte) => parte.tipo === "IPI");
    assert.equal(ipi?.tratamentoCusto, "INTEGRA_CUSTO");
  });

  it("28. desconto do item reduz o custo, e nao apenas o valor fiscal", () => {
    const entrada = destinarTudo(
      montarXml({
        icmsTot: { vProd: "100.00", vDesc: "10.00", vNF: "90.00" },
        itens: [item({ prod: { vDesc: "10.00" } })],
      }),
    );

    assert.equal(entrada.valorFiscalDestinado, 90);
    assert.equal(entrada.custoEstoqueDestinado, 90);
    const desconto = entrada.linhas[0].componentes.find(
      (parte) => parte.tipo === "DESCONTO",
    );
    assert.equal(desconto?.tratamentoCusto, "REDUZ_CUSTO");
    assert.equal(desconto?.sinalFiscal, -1);
  });

  it("29. o que fica fora do custo diz para onde vai, e nao e um 'nao' calado", () => {
    // O ICMS-ST era `PENDENTE_DE_CLASSIFICACAO` enquanto ninguém tinha decidido
    // onde reconhecê-lo. A decisão saiu: pago na compra, nunca vira mercadoria,
    // logo não tem baixa futura para esperar e entra no resultado do período. O
    // estado pendente continua existindo para o que ainda não foi decidido.
    const entrada = destinarTudo(notaComST());
    const fora = componentesForaDoCusto(entrada);

    assert.equal(fora.length, 1);
    assert.equal(fora[0].tipo, "ICMS_ST");
    assert.equal(fora[0].valor, 22);
    assert.equal(fora[0].origem, "ITEM");
    assert.equal(fora[0].numeroItem, 1);
    assert.equal(fora[0].compoeValorNFe, true);
    assert.equal(fora[0].tratamentoCusto, "NAO_INTEGRA_CUSTO");
    assert.equal(fora[0].destinoContabil, "RESULTADO");
    assert.match(fora[0].motivoDoTratamento, /não integra o estoque/);
  });

  it("29b. o servico da nota continua pendente: nao entrou no custo nem no resultado", () => {
    const entrada = destinarTudo(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "150.00" },
        issqnTot: { vServ: "50.00" },
      }),
    );
    const servico = entrada.naoAlocados.find((parte) => parte.tipo === "SERVICOS");

    assert.equal(servico?.tratamentoCusto, "PENDENTE_DE_CLASSIFICACAO");
    assert.equal(servico?.destinoContabil, "PENDENTE");
  });

  it("o que fica fora do custo explica exatamente a distancia entre os dois", () => {
    const entrada = destinarTudo(notaComST());
    const distancia = componentesForaDoCusto(entrada).reduce(
      (total, parte) => total + parte.sinalFiscal * Math.round(parte.valor * 100),
      0,
    );

    assert.equal(
      Math.round(entrada.custoEstoqueDestinado * 100) + distancia,
      Math.round(entrada.valorFiscalDestinado * 100),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Regressão: a fixture completa de R$ 5.296,00
 * ------------------------------------------------------------------ */

describe("regressao da NF-e de teste de R$ 5.296,00", () => {
  const fixture = () =>
    montarXml({
      icmsTot: {
        vProd: "5000.00",
        vDesc: "50.00",
        vICMSDeson: "80.00",
        vST: "180.00",
        vFCPST: "20.00",
        vICMSMonoReten: "15.00",
        vFrete: "30.00",
        vSeg: "10.00",
        vOutro: "20.00",
        vII: "40.00",
        vIPI: "50.00",
        vIPIDevol: "25.00",
        vICMS: "600.00",
        vTotTrib: "900.00",
        vNF: "5296.00",
      },
      itens: [
        item({
          nItem: 1,
          prod: {
            cProd: "TESTE-001",
            vUnCom: "1000.00",
            vProd: "1000.00",
            vFrete: "30.00",
            vSeg: "10.00",
            vDesc: "50.00",
            vOutro: "20.00",
          },
          icms: { grupo: "ICMS00", campos: { orig: 0, CST: "00", vICMS: "180.00" } },
          pisST: { vPIS: "12.00", indSomaPISST: 1 },
          cofinsST: { vCOFINS: "24.00", indSomaCOFINSST: 1 },
        }),
        item({
          nItem: 2,
          prod: {
            cProd: "TESTE-002",
            qCom: "2.0000",
            vUnCom: "1000.00",
            vProd: "2000.00",
          },
          icms: {
            grupo: "ICMS10",
            campos: { orig: 0, CST: 10, vICMSST: "180.00", vFCPST: "20.00" },
          },
        }),
        item({
          nItem: 3,
          prod: {
            cProd: "TESTE-003",
            CFOP: "3202",
            vUnCom: "500.00",
            vProd: "500.00",
          },
          ipi: { CST: 50, vIPI: "50.00" },
          ii: { vII: "40.00" },
        }),
        item({
          nItem: 4,
          prod: { cProd: "TESTE-004", vUnCom: "800.00", vProd: "800.00" },
          icms: {
            grupo: "ICMS40",
            campos: { orig: 0, CST: 40, vICMSDeson: "80.00", motDesICMS: 9 },
          },
        }),
        item({
          nItem: 5,
          prod: { cProd: "TESTE-005", vUnCom: "700.00", vProd: "700.00" },
          impostoDevol: { vIPIDevol: "25.00" },
        }),
      ],
    });

  it("com os 5 itens destinados, o valor fiscal e 5.296,00 e nao 5.060,00", () => {
    const entrada = destinarTudo(fixture());

    assert.equal(entrada.notaInteira, true);
    assert.equal(entrada.valorFiscalDestinado, 5296);
    assert.equal(entrada.totalDaNota, 5296);
    assert.equal(entrada.diferencaParaONota, 0);
    assert.notEqual(entrada.valorFiscalDestinado, 5060);
  });

  it("cada item carrega o valor fiscal dos seus proprios componentes", () => {
    const entrada = destinarTudo(fixture());

    assert.deepEqual(
      entrada.linhas.map((linha) => linha.valorFiscalDoItem),
      // 1000−50+30+10+20+12+24 | 2000+180+20 | 500+40+50 | 800−80 | 700+25
      [1046, 2200, 590, 720, 725],
    );
    // O ICMS-ST do item 2 pertence ao item 2 e entra inteiro no valor fiscal
    // dele: nada dos 180,00 foi para rateio. A única coisa rateada nesta nota é
    // o ICMS monofásico retido, que não tem <det> nenhum.
    const st = entrada.linhas[1].componentes.find((parte) => parte.tipo === "ICMS_ST");
    assert.equal(st?.origem, "ITEM");
    assert.equal(st?.numeroItem, 2);
    assert.equal(st?.valor, 180);
    assert.deepEqual(
      entrada.naoAlocados.map((parte) => parte.tipo),
      ["ICMS_MONO_RETEN"],
    );
  });

  it("so o ICMS monofasico retido fica sem alocacao, e ainda assim e apropriado", () => {
    const entrada = destinarTudo(fixture());

    assert.equal(entrada.naoAlocados.length, 1);
    assert.equal(entrada.naoAlocados[0].tipo, "ICMS_MONO_RETEN");
    assert.equal(entrada.naoAlocados[0].valor, 15);
    assert.equal(entrada.naoAlocados[0].compoeValorNFe, true);

    const rateado = entrada.linhas.reduce(
      (total, linha) => total + Math.round(linha.cotaNaoAlocada * 100),
      0,
    );
    assert.equal(rateado, 1500);
  });

  it("o custo de estoque continua sendo a regra do ERP, 5.060,00", () => {
    const entrada = destinarTudo(fixture());

    assert.equal(entrada.custoEstoqueDestinado, 5060);
    // E a diferença de 236,00 tem nome, item e tratamento — não é um resto.
    const fora = componentesForaDoCusto(entrada);
    const distancia = fora.reduce(
      (total, parte) => total + parte.sinalFiscal * Math.round(parte.valor * 100),
      0,
    );
    assert.equal(distancia, 23600);
    assert.deepEqual(
      fora.map((parte) => [parte.tipo, parte.valor, parte.numeroItem]),
      // Na ordem das linhas, e cada um com o item de origem — os que só existem
      // no total vêm por último, com `numeroItem` nulo.
      [
        ["PIS_ST", 12, 1],
        ["COFINS_ST", 24, 1],
        ["ICMS_ST", 180, 2],
        ["FCP_ST", 20, 2],
        ["IMPOSTO_IMPORTACAO", 40, 3],
        ["ICMS_DESONERADO", 80, 4],
        ["IPI_DEVOLVIDO", 25, 5],
        ["ICMS_MONO_RETEN", 15, null],
      ],
    );
    assert.equal(
      Math.round(entrada.custoEstoqueDestinado * 100) + distancia,
      Math.round(entrada.valorFiscalDestinado * 100),
    );
  });

  it("destinando so o item 2, leva 2.200,00 de valor fiscal e 2.000,00 de custo", () => {
    const { totais, itens } = ler(fixture());
    const entrada = calcularValorFiscalDaEntrada(totais, itens, [{ numeroItem: 2 }]);

    assert.equal(entrada.notaInteira, false);
    // 2.200,00 do item mais a cota inteira do mono retido, que so tem esta linha.
    assert.equal(entrada.linhas[0].valorFiscalDoItem, 2200);
    assert.equal(entrada.custoEstoqueDestinado, 2000);
  });
});

/* ------------------------------------------------------------------ *
 * Componentes soltos
 * ------------------------------------------------------------------ */

describe("metadados dos componentes", () => {
  it("cada componente diz de onde veio e se compoe o vNF", () => {
    const { totais, itens } = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vST: "22.00", vNF: "122.00" },
        itens: [
          item({
            icms: {
              grupo: "ICMS10",
              campos: { orig: 0, CST: 10, vICMS: "18.00", vICMSST: "22.00" },
            },
          }),
        ],
      }),
    );

    const componentes = componentesDoItem(itens[0], totais);
    const st = componentes.find((parte) => parte.tipo === "ICMS_ST");
    assert.deepEqual(
      {
        tipo: st?.tipo,
        valor: st?.valor,
        origem: st?.origem,
        numeroItem: st?.numeroItem,
        compoeValorNFe: st?.compoeValorNFe,
        sinalFiscal: st?.sinalFiscal,
      },
      {
        tipo: "ICMS_ST",
        valor: 22,
        origem: "ITEM",
        numeroItem: 1,
        compoeValorNFe: true,
        sinalFiscal: 1,
      },
    );
  });

  it("no faturamento direto de veiculo novo o ST nao compoe e nao e apropriado", () => {
    const { totais, itens } = ler(
      montarXml({
        ide: { tpOp: 2 },
        icmsTot: {
          vProd: "80000.00",
          vST: "6000.00",
          vFCPST: "400.00",
          vIPI: "5000.00",
          vNF: "85000.00",
        },
        itens: [
          item({
            prod: { vUnCom: "80000.00", vProd: "80000.00" },
            icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "6000.00" } },
            ipi: { vIPI: "5000.00" },
          }),
        ],
      }),
    );

    const entrada = calcularValorFiscalDaEntrada(totais, itens, [{ numeroItem: 1 }]);
    assert.equal(entrada.valorFiscalDestinado, 85000);

    const st = componentesDoItem(itens[0], totais).find(
      (parte) => parte.tipo === "ICMS_ST",
    );
    assert.equal(st?.compoeValorNFe, false);
    assert.equal(st?.sinalFiscal, 0);
    assert.equal(st?.valor, 6000);
  });

  it("componentesNaoAlocados so lista o que o total declara alem dos itens", () => {
    const { totais } = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vICMSMonoReten: "15.00", vNF: "115.00" },
      }),
    );

    const naoAlocados = componentesNaoAlocados(totais);
    assert.equal(naoAlocados.length, 1);
    assert.equal(naoAlocados[0].tipo, "ICMS_MONO_RETEN");
    assert.equal(naoAlocados[0].origem, "TOTAL_NFE");
    assert.equal(naoAlocados[0].numeroItem, null);
  });
});
