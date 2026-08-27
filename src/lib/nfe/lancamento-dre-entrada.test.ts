import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  conferirIdentidade,
  lancamentosDreDaEntrada,
  totalDosLancamentos,
} from "./lancamento-dre-entrada";
import { lerItensDaNota, lerNFeDoXml, lerTotaisDaNota } from "./totais-nfe";
import {
  calcularValorFiscalDaEntrada,
  type LinhaDestinada,
  type TipoDeComponente,
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
    impostoDevol?: Campos;
    vTotTrib?: number | string;
  } = {},
): string {
  const prod = {
    cProd: "PC-1",
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
    opcoes.pisST ? `<PISST>${tags(opcoes.pisST)}</PISST>` : "",
    opcoes.cofinsST ? `<COFINSST>${tags(opcoes.cofinsST)}</COFINSST>` : "",
  ].join("");

  const devol = opcoes.impostoDevol
    ? `<impostoDevol><pDevol>100.00</pDevol><IPI>${tags(opcoes.impostoDevol)}</IPI></impostoDevol>`
    : "";

  return `<det nItem="${opcoes.nItem ?? 1}"><prod>${tags(prod)}</prod><imposto>${imposto}</imposto>${devol}</det>`;
}

function montarXml(
  opcoes: { icmsTot?: Campos; itens?: string[] } = {},
): string {
  const icmsTot = { vProd: "100.00", vNF: "100.00", ...opcoes.icmsTot };

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe>` +
    `<infNFe Id="NFe25260812345678000199550010000012341000012348" versao="4.00">` +
    `<ide>${tags({ cUF: 25, mod: 55, serie: 1, nNF: 1234, dhEmi: "2026-08-25T09:00:00-03:00", tpNF: 1 })}</ide>` +
    `<emit><CNPJ>12345678000199</CNPJ><xNome>Fornecedor</xNome></emit>` +
    `<dest><CNPJ>98765432000188</CNPJ><xNome>Oficina</xNome></dest>` +
    (opcoes.itens ?? [item()]).join("") +
    `<total><ICMSTot>${tags(icmsTot)}</ICMSTot></total>` +
    `</infNFe></NFe></nfeProc>`
  );
}

function entradaDe(xml: string, destinadas?: LinhaDestinada[]) {
  const { infNFe } = lerNFeDoXml(xml);
  assert.ok(infNFe);
  const totais = lerTotaisDaNota(infNFe);
  const itens = lerItensDaNota(infNFe);
  return calcularValorFiscalDaEntrada(
    totais,
    itens,
    destinadas ?? itens.map((i) => ({ numeroItem: i.numeroItem })),
  );
}

/** Os lançamentos indexados por tipo, que é como a DRE os grava. */
function porTipo(xml: string, destinadas?: LinhaDestinada[]) {
  const lancamentos = lancamentosDreDaEntrada(entradaDe(xml, destinadas));
  return new Map(lancamentos.map((lancamento) => [lancamento.tipo, lancamento]));
}

/* ------------------------------------------------------------------ *
 * A fixture completa de R$ 5.296,00
 * ------------------------------------------------------------------ */

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
        prod: { cProd: "TESTE-002", qCom: "2.0000", vUnCom: "1000.00", vProd: "2000.00" },
        icms: {
          grupo: "ICMS10",
          campos: { orig: 0, CST: 10, vICMSST: "180.00", vFCPST: "20.00" },
        },
      }),
      item({
        nItem: 3,
        prod: { cProd: "TESTE-003", CFOP: "3202", vUnCom: "500.00", vProd: "500.00" },
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

/* ------------------------------------------------------------------ *
 * 1 a 6 — a identidade que amarra estoque e resultado
 * ------------------------------------------------------------------ */

describe("a identidade entre custo de estoque e lancamento na DRE", () => {
  it("1. custo + despesas − recuperacoes + pendentes = valor fiscal, na fixture inteira", () => {
    const conferencia = conferirIdentidade(entradaDe(fixture()));

    assert.equal(conferencia.fecha, true);
    assert.equal(conferencia.diferenca, 0);
    assert.equal(conferencia.valorFiscal, 5296);
  });

  it("2. o custo de estoque continua sendo 5.060,00 — a compra nao virou despesa", () => {
    assert.equal(conferirIdentidade(entradaDe(fixture())).custoEstoque, 5060);
  });

  it("3. a DRE recebe 316,00 de despesa e 80,00 de recuperacao", () => {
    const conferencia = conferirIdentidade(entradaDe(fixture()));

    // 12 + 24 + 180 + 20 + 40 + 25 + 15
    assert.equal(conferencia.despesas, 316);
    assert.equal(conferencia.recuperacoes, 80);
    assert.equal(conferencia.pendentes, 0);
  });

  it("4. o liquido lancado e exatamente a distancia entre o vNF e o custo", () => {
    const entrada = entradaDe(fixture());
    const liquido = totalDosLancamentos(lancamentosDreDaEntrada(entrada));

    assert.equal(liquido, 236);
    assert.equal(entrada.valorFiscalDestinado - entrada.custoEstoqueDestinado, 236);
  });

  it("5. cada tributo vira um lancamento proprio, com o valor do seu grupo", () => {
    const lancado = porTipo(fixture());

    assert.equal(lancado.get("ICMS_ST")?.valor, 180);
    assert.equal(lancado.get("FCP_ST")?.valor, 20);
    assert.equal(lancado.get("IMPOSTO_IMPORTACAO")?.valor, 40);
    assert.equal(lancado.get("IPI_DEVOLVIDO")?.valor, 25);
    assert.equal(lancado.get("PIS_ST")?.valor, 12);
    assert.equal(lancado.get("COFINS_ST")?.valor, 24);
    assert.equal(lancado.get("ICMS_MONO_RETEN")?.valor, 15);
    assert.equal(lancado.get("ICMS_DESONERADO")?.valor, 80);
  });

  it("6. todo lancamento tem valor positivo: o sinal mora na linha da DRE", () => {
    for (const lancamento of lancamentosDreDaEntrada(entradaDe(fixture()))) {
      assert.ok(lancamento.valor > 0, `${lancamento.tipo} veio ${lancamento.valor}`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 7 a 12 — o que NAO pode virar lancamento
 * ------------------------------------------------------------------ */

describe("o que continua esperando a baixa do item", () => {
  const naoLancados: TipoDeComponente[] = [
    "PRODUTO",
    "DESCONTO",
    "FRETE",
    "SEGURO",
    "OUTRAS_DESPESAS",
    "IPI",
  ];

  for (const [indice, tipo] of naoLancados.entries()) {
    it(`${7 + indice}. ${tipo} fica no custo do estoque e nao vira lancamento`, () => {
      assert.equal(porTipo(fixture()).has(tipo), false);
    });
  }
});

describe("o que nunca e lancamento em hipotese nenhuma", () => {
  it("13. o ICMS proprio da nota nao vira despesa: e o caso real de 458,34", () => {
    const xml = montarXml({
      icmsTot: {
        vProd: "334.00",
        vBC: "334.00",
        vICMS: "13.36",
        vBCST: "621.70",
        vST: "124.34",
        vNF: "458.34",
      },
      itens: [
        item({
          nItem: 1,
          prod: {
            cProd: "RACOR-01",
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
              vBCST: "621.70",
              vICMSST: "124.34",
            },
          },
        }),
      ],
    });

    const entrada = entradaDe(xml);
    const lancado = porTipo(xml);

    assert.equal(entrada.valorFiscalDestinado, 458.34);
    assert.equal(entrada.custoEstoqueDestinado, 334);
    assert.equal(lancado.size, 1);
    assert.equal(lancado.get("ICMS_ST")?.valor, 124.34);
    assert.equal(lancado.has("ICMS_PROPRIO"), false);
    assert.equal(conferirIdentidade(entrada).fecha, true);
    // O erro que este teste existe para impedir: 334 + 124,34 + 13,36.
    assert.notEqual(entrada.custoEstoqueDestinado + (lancado.get("ICMS_ST")?.valor ?? 0), 471.7);
  });

  it("14. nenhum componente informativo do XML vira lancamento", () => {
    const lancado = porTipo(fixture());
    const informativos: TipoDeComponente[] = [
      "ICMS_PROPRIO",
      "PIS",
      "COFINS",
      "FCP",
      "FCP_ST_RETIDO",
      "ICMS_MONO",
      "ICMS_MONO_RETIDO",
      "TOTAL_TRIBUTOS",
    ];

    for (const tipo of informativos) assert.equal(lancado.has(tipo), false, tipo);
  });

  it("15. o vTotTrib de 900,00 da fixture nao aparece em lancamento nenhum", () => {
    const valores = lancamentosDreDaEntrada(entradaDe(fixture())).map((l) => l.valor);
    assert.equal(valores.includes(900), false);
  });

  it("16. nota sem tributo fora do custo nao gera lancamento algum", () => {
    const xml = montarXml({
      icmsTot: { vProd: "100.00", vFrete: "10.00", vNF: "110.00" },
      itens: [item({ prod: { vFrete: "10.00" } })],
    });
    const entrada = entradaDe(xml);

    assert.deepEqual(lancamentosDreDaEntrada(entrada), []);
    assert.equal(entrada.custoEstoqueDestinado, 110);
    assert.equal(conferirIdentidade(entrada).fecha, true);
  });
});

/* ------------------------------------------------------------------ *
 * 17 a 21 — natureza, descricao e agrupamento
 * ------------------------------------------------------------------ */

describe("a forma do lancamento", () => {
  it("17. tributo cobrado e DESPESA; desoneracao concedida e RECEITA", () => {
    const lancado = porTipo(fixture());

    assert.equal(lancado.get("ICMS_ST")?.natureza, "DESPESA");
    assert.equal(lancado.get("ICMS_DESONERADO")?.natureza, "RECEITA");
  });

  it("18. a origem do evento e sempre ENTRADA_FISCAL", () => {
    for (const lancamento of lancamentosDreDaEntrada(entradaDe(fixture()))) {
      assert.equal(lancamento.origemEvento, "ENTRADA_FISCAL");
    }
  });

  it("19. cada lancamento explica o motivo fiscal, para o drill-down nao ficar mudo", () => {
    const icmsST = porTipo(fixture()).get("ICMS_ST");

    assert.ok(icmsST);
    assert.match(icmsST.descricao, /ICMS-ST/);
    assert.match(icmsST.detalhe, /não integra o estoque|nao integra o estoque/i);
  });

  it("20. o mesmo tributo em varios itens vira um lancamento so, detalhado por item", () => {
    const xml = montarXml({
      icmsTot: { vProd: "200.00", vST: "30.00", vNF: "230.00" },
      itens: [
        item({
          nItem: 1,
          icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "10.00" } },
        }),
        item({
          nItem: 2,
          icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "20.00" } },
        }),
      ],
    });

    const icmsST = porTipo(xml).get("ICMS_ST");

    assert.equal(icmsST?.valor, 30);
    assert.deepEqual(icmsST?.itens, [
      { numeroItem: 1, valor: 10 },
      { numeroItem: 2, valor: 20 },
    ]);
  });

  it("21. um tipo com valor liquido zero nao vira lancamento", () => {
    const xml = montarXml({
      icmsTot: { vProd: "100.00", vST: "0.00", vNF: "100.00" },
      itens: [
        item({ icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "0.00" } } }),
      ],
    });

    assert.deepEqual(lancamentosDreDaEntrada(entradaDe(xml)), []);
  });
});

/* ------------------------------------------------------------------ *
 * 22 a 25 — destinacao parcial
 * ------------------------------------------------------------------ */

describe("destinacao parcial", () => {
  it("22. destinar so um item lanca apenas os tributos daquele item", () => {
    const lancado = porTipo(fixture(), [{ numeroItem: 2 }]);

    assert.equal(lancado.get("ICMS_ST")?.valor, 180);
    assert.equal(lancado.get("FCP_ST")?.valor, 20);
    assert.equal(lancado.has("IMPOSTO_IMPORTACAO"), false);
    assert.equal(lancado.has("PIS_ST"), false);
  });

  it("23. metade da quantidade lanca metade do tributo", () => {
    const xml = montarXml({
      icmsTot: { vProd: "200.00", vST: "40.00", vNF: "240.00" },
      itens: [
        item({
          prod: { qCom: "2.0000", vUnCom: "100.00", vProd: "200.00" },
          icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "40.00" } },
        }),
      ],
    });

    const lancado = porTipo(xml, [{ numeroItem: 1, quantidadeDestinada: 1 }]);
    assert.equal(lancado.get("ICMS_ST")?.valor, 20);
  });

  it("24. a identidade fecha no centavo mesmo com quantidade que nao divide exato", () => {
    const xml = montarXml({
      icmsTot: { vProd: "300.00", vST: "10.01", vNF: "310.01" },
      itens: [
        item({
          prod: { qCom: "3.0000", vUnCom: "100.00", vProd: "300.00" },
          icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "10.01" } },
        }),
      ],
    });

    const conferencia = conferirIdentidade(
      entradaDe(xml, [{ numeroItem: 1, quantidadeDestinada: 1 }]),
    );

    assert.equal(conferencia.fecha, true);
    assert.equal(conferencia.diferenca, 0);
  });

  it("25. destinar nenhuma linha nao lanca nada", () => {
    assert.deepEqual(lancamentosDreDaEntrada(entradaDe(fixture(), [])), []);
  });
});

/* ------------------------------------------------------------------ *
 * 26 a 30 — valores sem alocacao por item e a NF-e mista
 * ------------------------------------------------------------------ */

describe("valores que so existem no total da NF-e", () => {
  it("26. tributo declarado so no total tambem vai para a DRE", () => {
    const lancado = porTipo(fixture()).get("ICMS_MONO_RETEN");

    assert.equal(lancado?.valor, 15);
    assert.deepEqual(lancado?.itens, [{ numeroItem: null, valor: 15 }]);
    assert.match(lancado?.detalhe ?? "", /só no total|so no total/i);
  });

  it("27. despesa de aquisicao sem alocacao por item fica PENDENTE, nao vira despesa", () => {
    // Frete de cabeçalho que o emitente não repartiu: seria custo, mas chegar ao
    // custo exigiria um rateio que ninguém decidiu. Fica visível como pendente.
    const xml = montarXml({
      icmsTot: { vProd: "100.00", vFrete: "30.00", vNF: "130.00" },
    });
    const entrada = entradaDe(xml);
    const conferencia = conferirIdentidade(entrada);

    assert.equal(lancamentosDreDaEntrada(entrada).length, 0);
    assert.equal(conferencia.pendentes, 30);
    assert.equal(conferencia.custoEstoque, 100);
    assert.equal(conferencia.valorFiscal, 130);
    assert.equal(conferencia.fecha, true);
  });

  it("28. o pendente nunca e escondido como zero", () => {
    const xml = montarXml({ icmsTot: { vProd: "100.00", vFrete: "30.00", vNF: "130.00" } });
    assert.notEqual(conferirIdentidade(entradaDe(xml)).pendentes, 0);
  });

  it("29. na NF-e mista cada lado leva os seus itens", () => {
    const entrada = entradaDe(fixture());

    const produto = lancamentosDreDaEntrada(entrada, {
      numerosDeItem: [1, 2, 3],
      incluirNaoAlocados: true,
    });
    const usoConsumo = lancamentosDreDaEntrada(entrada, {
      numerosDeItem: [4, 5],
      incluirNaoAlocados: false,
    });

    assert.equal(produto.find((l) => l.tipo === "ICMS_ST")?.valor, 180);
    assert.equal(usoConsumo.find((l) => l.tipo === "IPI_DEVOLVIDO")?.valor, 25);
    assert.equal(usoConsumo.some((l) => l.tipo === "ICMS_ST"), false);
  });

  it("30. os dois lados da NF-e mista somados nao repetem o valor sem alocacao", () => {
    const entrada = entradaDe(fixture());

    const produto = lancamentosDreDaEntrada(entrada, {
      numerosDeItem: [1, 2, 3],
      incluirNaoAlocados: true,
    });
    const usoConsumo = lancamentosDreDaEntrada(entrada, {
      numerosDeItem: [4, 5],
      incluirNaoAlocados: false,
    });

    assert.equal(
      totalDosLancamentos([...produto, ...usoConsumo]),
      totalDosLancamentos(lancamentosDreDaEntrada(entrada)),
    );
    assert.equal(
      [...produto, ...usoConsumo].filter((l) => l.tipo === "ICMS_MONO_RETEN").length,
      1,
    );
  });
});
