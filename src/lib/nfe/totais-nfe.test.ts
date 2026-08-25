import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alocacaoPorItem,
  componentesForaDoCustoDaLinha,
  componentesDoTotal,
  lerItensDaNota,
  lerNFeDoXml,
  lerTotaisDaNota,
  valoresSemAlocacaoPorItem,
  type AlocacaoDeCampo,
  type TotaisDaNota,
} from "./totais-nfe";

/* ------------------------------------------------------------------ *
 * Fixtures
 *
 * O XML é montado inteiro e passa pelo mesmo `fast-xml-parser` da rota de
 * entrada, porque metade dos defeitos que motivaram este módulo estava no
 * caminho XML → objeto, não na aritmética.
 * ------------------------------------------------------------------ */

type Campos = Record<string, string | number | undefined>;

function tags(campos: Campos = {}): string {
  return Object.entries(campos)
    .filter(([, valor]) => valor !== undefined)
    .map(([nome, valor]) => `<${nome}>${valor}</${nome}>`)
    .join("");
}

function item(opcoes: {
  nItem?: number;
  prod?: Campos;
  icms?: { grupo: string; campos: Campos };
  ipi?: Campos;
  ii?: Campos;
  pisST?: Campos;
  cofinsST?: Campos;
  impostoDevol?: Campos;
  vTotTrib?: number | string;
} = {}): string {
  const prod = {
    cProd: "PC-1",
    cEAN: "SEM GTIN",
    xProd: "Pastilha de freio",
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

function montarXml(opcoes: {
  ide?: Campos;
  icmsTot?: Campos;
  issqnTot?: Campos;
  retTrib?: Campos;
  totalExtra?: string;
  itens?: string[];
  cobr?: string;
  pag?: string;
  envelope?: "nfeProc" | "NFe" | "infNFe";
  comPrefixoDeNamespace?: boolean;
} = {}): string {
  const ide = {
    cUF: 25,
    natOp: "COMPRA",
    mod: 55,
    serie: 1,
    nNF: 1234,
    dhEmi: "2026-03-10T09:00:00-03:00",
    tpNF: 1,
    ...opcoes.ide,
  };

  const icmsTot = { vProd: "100.00", vNF: "100.00", ...opcoes.icmsTot };

  const total = [
    `<ICMSTot>${tags(icmsTot)}</ICMSTot>`,
    opcoes.issqnTot ? `<ISSQNtot>${tags(opcoes.issqnTot)}</ISSQNtot>` : "",
    opcoes.retTrib ? `<retTrib>${tags(opcoes.retTrib)}</retTrib>` : "",
    opcoes.totalExtra ?? "",
  ].join("");

  const corpo =
    `<ide>${tags(ide)}</ide>` +
    `<emit><CNPJ>12345678000199</CNPJ><xNome>Auto Pecas LTDA</xNome></emit>` +
    `<dest><CNPJ>98765432000188</CNPJ><xNome>Oficina</xNome></dest>` +
    (opcoes.itens ?? [item()]).join("") +
    `<total>${total}</total>` +
    (opcoes.cobr ?? "") +
    (opcoes.pag ?? "");

  const chave = "25260312345678000199550010000012341000012348";
  const p = opcoes.comPrefixoDeNamespace ? "nfe:" : "";
  const ns = opcoes.comPrefixoDeNamespace
    ? ` xmlns:nfe="http://www.portalfiscal.inf.br/nfe"`
    : ` xmlns="http://www.portalfiscal.inf.br/nfe"`;

  const infNFe = `<${p}infNFe Id="NFe${chave}" versao="4.00">${corpo.replaceAll("<", `<${p}`).replaceAll(`<${p}/`, `</${p}`)}</${p}infNFe>`;

  const envelope = opcoes.envelope ?? "nfeProc";
  if (envelope === "infNFe") {
    return `<?xml version="1.0" encoding="UTF-8"?>${infNFe.replace(`<${p}infNFe`, `<${p}infNFe${ns}`)}`;
  }
  if (envelope === "NFe") {
    return `<?xml version="1.0" encoding="UTF-8"?><${p}NFe${ns}>${infNFe}</${p}NFe>`;
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<${p}nfeProc${ns} versao="4.00">` +
    `<${p}NFe>${infNFe}</${p}NFe>` +
    `<${p}protNFe><${p}infProt><${p}chNFe>${chave}</${p}chNFe><${p}nProt>125260000000001</${p}nProt><${p}cStat>100</${p}cStat></${p}infProt></${p}protNFe>` +
    `</${p}nfeProc>`
  );
}

function ler(xml: string): TotaisDaNota {
  const { infNFe } = lerNFeDoXml(xml);
  assert.ok(infNFe, "o XML de teste precisa ter um infNFe reconhecível");
  return lerTotaisDaNota(infNFe);
}

/** O mesmo custo de linha que a tela de entrada usa (`totalDaLinha`). */
function custoDasLinhas(xml: string): number {
  const { infNFe } = lerNFeDoXml(xml);
  const centavos = lerItensDaNota(infNFe).reduce(
    (soma, i) =>
      soma +
      Math.round(
        (i.quantidade * i.valorUnitario -
          i.valorDesconto +
          i.valorFrete +
          i.valorSeguro +
          i.outrasDespesas +
          i.valorIpi) *
          100,
      ),
    0,
  );
  return centavos / 100;
}

/* ------------------------------------------------------------------ *
 * 1 a 12 — cada componente isolado
 * ------------------------------------------------------------------ */

describe("composicao do valor total da NF-e", () => {
  it("1. so produtos: o total e o proprio vProd", () => {
    const totais = ler(montarXml());

    assert.equal(totais.produtos, 100);
    assert.equal(totais.totalNota, 100);
    assert.equal(totais.totalCalculado, 100);
    assert.equal(totais.diferenca, 0);
    assert.equal(totais.composicaoValida, true);
    assert.equal(totais.regra, "CLASSICA");
  });

  it("2. desconto e redutor, nao acrescimo", () => {
    const totais = ler(
      montarXml({ icmsTot: { vProd: "100.00", vDesc: "10.00", vNF: "90.00" } }),
    );

    assert.equal(totais.reducoes.desconto, 10);
    assert.equal(totais.totalCalculado, 90);
    assert.equal(totais.composicaoValida, true);
  });

  it("3. frete entra no total", () => {
    const totais = ler(
      montarXml({ icmsTot: { vProd: "100.00", vFrete: "25.50", vNF: "125.50" } }),
    );

    assert.equal(totais.acrescimos.frete, 25.5);
    assert.equal(totais.totalCalculado, 125.5);
    assert.equal(totais.composicaoValida, true);
  });

  it("4. seguro entra no total", () => {
    const totais = ler(
      montarXml({ icmsTot: { vProd: "100.00", vSeg: "7.35", vNF: "107.35" } }),
    );

    assert.equal(totais.acrescimos.seguro, 7.35);
    assert.equal(totais.totalCalculado, 107.35);
    assert.equal(totais.composicaoValida, true);
  });

  it("5. outras despesas acessorias entram no total", () => {
    // O campo que mais aparece na nota que nao fechava: despesa cobrada pelo
    // fornecedor que nao e frete nem seguro.
    const totais = ler(
      montarXml({ icmsTot: { vProd: "100.00", vOutro: "42.90", vNF: "142.90" } }),
    );

    assert.equal(totais.acrescimos.outrasDespesas, 42.9);
    assert.equal(totais.totalCalculado, 142.9);
    assert.equal(totais.composicaoValida, true);
  });

  it("6. IPI entra no total", () => {
    const totais = ler(
      montarXml({ icmsTot: { vProd: "100.00", vIPI: "5.00", vNF: "105.00" } }),
    );

    assert.equal(totais.acrescimos.ipi, 5);
    assert.equal(totais.totalCalculado, 105);
    assert.equal(totais.composicaoValida, true);
  });

  it("7. imposto de importacao entra no total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vII: "18.00", vNF: "118.00" },
        itens: [item({ prod: { CFOP: "3102" }, ii: { vBC: "100.00", vII: "18.00" } })],
      }),
    );

    assert.equal(totais.acrescimos.impostoImportacao, 18);
    assert.equal(totais.totalCalculado, 118);
    assert.equal(totais.composicaoValida, true);
    assert.equal(totais.indicadores.importacao, true);
  });

  it("8. ICMS-ST entra no total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vBCST: "130.00", vST: "22.10", vNF: "122.10" },
        itens: [
          item({
            icms: {
              grupo: "ICMSSN201",
              campos: { orig: 0, CSOSN: 201, vBCST: "130.00", vICMSST: "22.10" },
            },
          }),
        ],
      }),
    );

    assert.equal(totais.acrescimos.icmsST, 22.1);
    assert.equal(totais.totalCalculado, 122.1);
    assert.equal(totais.composicaoValida, true);
    // A base de calculo NAO e dinheiro cobrado.
    assert.equal(totais.informativos.baseIcmsST, 130);
  });

  it("9. FCP-ST entra no total, e vFCP e vFCPSTRet nao", () => {
    const totais = ler(
      montarXml({
        icmsTot: {
          vProd: "100.00",
          vST: "20.00",
          vFCPST: "2.60",
          vFCP: "1.00",
          vFCPSTRet: "3.00",
          vNF: "122.60",
        },
      }),
    );

    assert.equal(totais.acrescimos.fcpST, 2.6);
    assert.equal(totais.informativos.fcp, 1);
    assert.equal(totais.informativos.fcpSTRet, 3);
    assert.equal(totais.totalCalculado, 122.6);
    assert.equal(totais.composicaoValida, true);
  });

  it("10. ICMS monofasico sujeito a retencao entra; o mono normal e a quantidade-base nao", () => {
    const totais = ler(
      montarXml({
        icmsTot: {
          vProd: "100.00",
          qBCMono: "50.0000",
          vICMSMono: "9.00",
          qBCMonoReten: "50.0000",
          vICMSMonoReten: "4.00",
          qBCMonoRet: "10.0000",
          vICMSMonoRet: "1.00",
          vNF: "104.00",
        },
      }),
    );

    assert.equal(totais.acrescimos.icmsMonoReten, 4);
    assert.equal(totais.informativos.icmsMono, 9);
    assert.equal(totais.informativos.icmsMonoRet, 1);
    assert.equal(totais.informativos.quantidadeBaseMono, 50);
    assert.equal(totais.totalCalculado, 104);
    assert.equal(totais.composicaoValida, true);
  });

  it("11. ICMS desonerado: reconhece tanto a nota que subtrai quanto a que nao subtrai", () => {
    const subtraiu = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vICMSDeson: "12.00", vNF: "88.00" },
      }),
    );
    assert.equal(subtraiu.regra, "CLASSICA");
    assert.equal(subtraiu.composicaoValida, true);
    assert.equal(subtraiu.totalCalculado, 88);

    // Exceção histórica: há emissor cujo vNF nunca teve a desoneração descontada.
    // Forçar a subtração inventaria uma divergência de 12 reais.
    const naoSubtraiu = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vICMSDeson: "12.00", vNF: "100.00" },
      }),
    );
    assert.equal(naoSubtraiu.regra, "CLASSICA_SEM_DESONERACAO");
    assert.equal(naoSubtraiu.composicaoValida, true);
    assert.equal(naoSubtraiu.totalCalculado, 100);
    assert.equal(naoSubtraiu.reducoes.icmsDesonerado, 12);
  });

  it("12. IPI devolvido entra no total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vIPIDevol: "8.00", vNF: "108.00" },
        itens: [item({ impostoDevol: { vIPIDevol: "8.00" } })],
      }),
    );

    assert.equal(totais.acrescimos.ipiDevolvido, 8);
    assert.equal(totais.conferenciaDosItens.ipiDevolvido, 8);
    assert.equal(totais.totalCalculado, 108);
    assert.equal(totais.composicaoValida, true);
  });
});

/* ------------------------------------------------------------------ *
 * 13 a 16 — PIS-ST e COFINS-ST dependem do indicador do proprio XML
 * ------------------------------------------------------------------ */

describe("PIS-ST e COFINS-ST", () => {
  it("13. PIS-ST com indSomaPISST=1 compoe o total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "103.00" },
        itens: [item({ pisST: { vBC: "100.00", vPIS: "3.00", indSomaPISST: 1 } })],
      }),
    );

    assert.equal(totais.acrescimos.pisSTCompoeTotal, 3);
    assert.equal(totais.indicadores.somaPisST, true);
    assert.equal(totais.totalCalculado, 103);
    assert.equal(totais.composicaoValida, true);
  });

  it("14. PIS-ST com indSomaPISST=0 fica de fora do total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        itens: [item({ pisST: { vBC: "100.00", vPIS: "3.00", indSomaPISST: 0 } })],
      }),
    );

    assert.equal(totais.acrescimos.pisSTCompoeTotal, 0);
    assert.equal(totais.indicadores.somaPisST, false);
    assert.equal(totais.totalCalculado, 100);
    assert.equal(totais.composicaoValida, true);
  });

  it("15. COFINS-ST com indSomaCOFINSST=1 compoe o total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "114.00" },
        itens: [
          item({ cofinsST: { vBC: "100.00", vCOFINS: "14.00", indSomaCOFINSST: 1 } }),
        ],
      }),
    );

    assert.equal(totais.acrescimos.cofinsSTCompoeTotal, 14);
    assert.equal(totais.totalCalculado, 114);
    assert.equal(totais.composicaoValida, true);
  });

  it("16. COFINS-ST sem o indicador nao e somado", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        itens: [item({ cofinsST: { vBC: "100.00", vCOFINS: "14.00" } })],
      }),
    );

    assert.equal(totais.acrescimos.cofinsSTCompoeTotal, 0);
    assert.equal(totais.indicadores.somaCofinsST, false);
    assert.equal(totais.totalCalculado, 100);
    assert.equal(totais.composicaoValida, true);
  });
});

/* ------------------------------------------------------------------ *
 * 17 a 19 — a nota completa e o que nunca pode entrar
 * ------------------------------------------------------------------ */

describe("nota com varios componentes ao mesmo tempo", () => {
  it("17. produtos, desconto e nove acrescimos fecham no vNF", () => {
    const totais = ler(
      montarXml({
        icmsTot: {
          vProd: "1000.00",
          vDesc: "50.00",
          vFrete: "80.00",
          vSeg: "20.00",
          vOutro: "30.00",
          vST: "150.00",
          vFCPST: "10.00",
          vICMSMonoReten: "15.00",
          vII: "25.00",
          vIPI: "100.00",
          vIPIDevol: "5.00",
          vNF: "1385.00",
        },
      }),
    );

    assert.equal(totais.totalCalculado, 1385);
    assert.equal(totais.totalNota, 1385);
    assert.equal(totais.diferenca, 0);
    assert.equal(totais.composicaoValida, true);
  });

  it("18. campos informativos nao alteram o total, por maiores que sejam", () => {
    // ICMS proprio, PIS e COFINS normais ja estao dentro do preco do produto.
    // Soma-los de novo era exatamente o erro que este modulo existe para evitar.
    const totais = ler(
      montarXml({
        icmsTot: {
          vProd: "100.00",
          vBC: "100.00",
          vICMS: "18.00",
          vPIS: "1.65",
          vCOFINS: "7.60",
          vFCP: "2.00",
          vFCPSTRet: "3.00",
          vICMSUFDest: "4.00",
          vFCPUFDest: "1.00",
          vICMSUFRemet: "2.00",
          vTotTrib: "33.00",
          vNF: "100.00",
        },
        itens: [item({ vTotTrib: "33.00" })],
      }),
    );

    assert.equal(totais.totalCalculado, 100);
    assert.equal(totais.composicaoValida, true);
    assert.equal(totais.informativos.icms, 18);
    assert.equal(totais.informativos.pis, 1.65);
    assert.equal(totais.informativos.cofins, 7.6);
    assert.equal(totais.informativos.icmsUFDest, 4);
    assert.equal(totais.informativos.totalTributos, 33);
    assert.equal(totais.informativos.baseIcms, 100);
  });

  it("19. retencoes ficam guardadas a parte, fora da composicao", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        retTrib: {
          vRetPIS: "0.65",
          vRetCOFINS: "3.00",
          vRetCSLL: "1.00",
          vBCIRRF: "100.00",
          vIRRF: "1.50",
          vBCRetPrev: "100.00",
          vRetPrev: "11.00",
        },
      }),
    );

    assert.equal(totais.retencoes.presente, true);
    assert.equal(totais.retencoes.retPIS, 0.65);
    assert.equal(totais.retencoes.irrf, 1.5);
    assert.equal(totais.retencoes.retPrev, 11);
    assert.equal(totais.retencoes.baseIRRF, 100);
    // Nem subtraidas nem somadas.
    assert.equal(totais.totalCalculado, 100);
    assert.equal(totais.composicaoValida, true);
  });
});

/* ------------------------------------------------------------------ *
 * 20 e 21 — o que o total NAO e
 * ------------------------------------------------------------------ */

describe("o total da NF-e nao se confunde com outros valores", () => {
  it("20. pagamento maior que a nota, com troco, nao muda o total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "5296.00", vNF: "5296.00" },
        itens: [item({ prod: { vUnCom: "5296.00", vProd: "5296.00" } })],
        pag: "<pag><detPag><tPag>01</tPag><vPag>5300.00</vPag></detPag><vTroco>4.00</vTroco></pag>",
      }),
    );

    assert.equal(totais.totalNota, 5296);
    assert.equal(totais.totalCalculado, 5296);
    assert.equal(totais.composicaoValida, true);
  });

  it("20b. fatura e duplicatas sao cobranca, nao componentes do total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        cobr:
          "<cobr><fat><nFat>1234</nFat><vOrig>100.00</vOrig><vDesc>0.00</vDesc><vLiq>100.00</vLiq></fat>" +
          "<dup><nDup>001</nDup><dVenc>2026-04-10</dVenc><vDup>50.00</vDup></dup>" +
          "<dup><nDup>002</nDup><dVenc>2026-05-10</dVenc><vDup>50.00</vDup></dup></cobr>",
      }),
    );

    assert.equal(totais.totalCalculado, 100);
    assert.equal(totais.composicaoValida, true);
  });

  it("21. IBS, CBS e IS de uma NF-e de 2026 sao lidos mas nao entram no total", () => {
    const totais = ler(
      montarXml({
        ide: { dhEmi: "2026-07-15T10:00:00-03:00" },
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        totalExtra:
          "<ISTot><vIS>3.00</vIS></ISTot>" +
          "<IBSCBSTot><vBCIBSCBS>100.00</vBCIBSCBS>" +
          "<gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>8.00</vIBSUF></gIBSUF>" +
          "<gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>2.00</vIBSMun></gIBSMun>" +
          "<vIBS>10.00</vIBS></gIBS>" +
          "<gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>9.00</vCBS></gCBS>" +
          "<gMono><vTotIBSMonoItem>1.00</vTotIBSMonoItem><vTotCBSMonoItem>0.50</vTotCBSMonoItem></gMono>" +
          "</IBSCBSTot>",
      }),
    );

    assert.equal(totais.reformaTributaria.presente, true);
    assert.equal(totais.reformaTributaria.compoeTotal, false);
    assert.equal(totais.reformaTributaria.is, 3);
    assert.equal(totais.reformaTributaria.ibs, 10);
    assert.equal(totais.reformaTributaria.ibsUF, 8);
    assert.equal(totais.reformaTributaria.ibsMunicipio, 2);
    assert.equal(totais.reformaTributaria.cbs, 9);
    assert.equal(totais.reformaTributaria.totIBSMonoItem, 1);
    assert.equal(totais.reformaTributaria.baseIBSCBS, 100);
    // O que importa: nada disso mexeu no total.
    assert.equal(totais.totalCalculado, 100);
    assert.equal(totais.composicaoValida, true);
  });
});

/* ------------------------------------------------------------------ *
 * 22 a 27 — bordas
 * ------------------------------------------------------------------ */

describe("bordas de leitura", () => {
  it("22. campo ausente vale zero, sem quebrar a leitura", () => {
    const totais = ler(montarXml({ icmsTot: { vProd: "100.00", vNF: "100.00" } }));

    assert.equal(totais.acrescimos.frete, 0);
    assert.equal(totais.acrescimos.seguro, 0);
    assert.equal(totais.acrescimos.outrasDespesas, 0);
    assert.equal(totais.reducoes.desconto, 0);
    assert.equal(totais.issqn, null);
    assert.equal(totais.retencoes.presente, false);
    assert.equal(totais.reformaTributaria.presente, false);
    assert.equal(totais.indicadores.vNFTot, null);
    assert.equal(totais.composicaoValida, true);
  });

  it("23. campo zerado se comporta como campo ausente", () => {
    const totais = ler(
      montarXml({
        icmsTot: {
          vProd: "100.00",
          vDesc: "0.00",
          vFrete: "0.00",
          vSeg: "0.00",
          vOutro: "0.00",
          vST: "0.00",
          vIPI: "0.00",
          vNF: "100.00",
        },
      }),
    );

    assert.equal(totais.totalCalculado, 100);
    assert.equal(totais.composicaoValida, true);
  });

  it("24. XML com o namespace da NF-e por prefixo e reconhecido", () => {
    const totais = ler(
      montarXml({
        comPrefixoDeNamespace: true,
        icmsTot: { vProd: "100.00", vFrete: "10.00", vNF: "110.00" },
      }),
    );

    assert.equal(totais.totalCalculado, 110);
    assert.equal(totais.composicaoValida, true);
  });

  it("25. XML nfeProc (com protocolo) e reconhecido", () => {
    const xml = montarXml({ envelope: "nfeProc" });
    const { documento, infNFe } = lerNFeDoXml(xml);

    assert.ok(infNFe);
    assert.ok((documento as { nfeProc?: unknown }).nfeProc);
    assert.equal(lerTotaisDaNota(infNFe).totalNota, 100);
  });

  it("26. XML contendo somente NFe, sem protocolo, e reconhecido", () => {
    const totais = ler(montarXml({ envelope: "NFe" }));
    assert.equal(totais.totalNota, 100);

    // E o recorte que alguns emissores mandam: infNFe direto na raiz.
    assert.equal(ler(montarXml({ envelope: "infNFe" })).totalNota, 100);
  });

  it("27. arredondamento monetario: a soma e feita em centavos, nao em float", () => {
    // Em float 0.1 + 0.2 da 0.30000000000000004 e a conferencia acusaria
    // divergencia numa nota que fecha certinho.
    const centavos = ler(
      montarXml({
        icmsTot: { vProd: "0.10", vFrete: "0.20", vNF: "0.30" },
        itens: [item({ prod: { qCom: "1.0000", vUnCom: "0.10", vProd: "0.10" } })],
      }),
    );
    assert.equal(centavos.totalCalculado, 0.3);
    assert.equal(centavos.diferenca, 0);
    assert.equal(centavos.composicaoValida, true);

    // Emissor que escreve o decimal com virgula.
    const comVirgula = ler(
      montarXml({ icmsTot: { vProd: "119,00", vFrete: "1,00", vNF: "120,00" } }),
    );
    assert.equal(comVirgula.produtos, 119);
    assert.equal(comVirgula.totalCalculado, 120);
    assert.equal(comVirgula.composicaoValida, true);
  });
});

/* ------------------------------------------------------------------ *
 * Item x total, e as exceções do leiaute
 * ------------------------------------------------------------------ */

describe("item e total nunca se somam", () => {
  it("frete no item e no total conta uma vez so; a soma dos itens fica na conferencia", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "200.00", vFrete: "30.00", vNF: "230.00" },
        itens: [
          item({ nItem: 1, prod: { vFrete: "18.00" } }),
          item({ nItem: 2, prod: { vFrete: "12.00" } }),
        ],
      }),
    );

    assert.equal(totais.acrescimos.frete, 30);
    assert.equal(totais.conferenciaDosItens.frete, 30);
    assert.equal(totais.totalCalculado, 230);
    assert.equal(totais.composicaoValida, true);
  });

  it("desconto por item nao se soma ao desconto do total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "200.00", vDesc: "20.00", vNF: "180.00" },
        itens: [
          item({ nItem: 1, prod: { vDesc: "15.00" } }),
          item({ nItem: 2, prod: { vDesc: "5.00" } }),
        ],
      }),
    );

    assert.equal(totais.reducoes.desconto, 20);
    assert.equal(totais.conferenciaDosItens.desconto, 20);
    assert.equal(totais.totalCalculado, 180);
  });

  it("item com indTot=0 fica de fora da soma de produtos dos itens", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        itens: [
          item({ nItem: 1 }),
          item({ nItem: 2, prod: { indTot: 0, vProd: "40.00", vUnCom: "40.00" } }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.produtos, 100);
    assert.equal(totais.totalCalculado, 100);
    assert.equal(totais.composicaoValida, true);
  });

  it("servicos do ISSQNtot entram no total e o resto do grupo fica so guardado", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "150.00" },
        issqnTot: {
          vServ: "50.00",
          vBC: "50.00",
          vISS: "2.50",
          vPIS: "0.33",
          vCOFINS: "1.52",
          vDeducao: "0.00",
          vDescIncond: "0.00",
          vDescCond: "0.00",
          vISSRet: "0.00",
        },
      }),
    );

    assert.equal(totais.acrescimos.servicos, 50);
    assert.equal(totais.issqn?.iss, 2.5);
    assert.equal(totais.totalCalculado, 150);
    assert.equal(totais.composicaoValida, true);
  });
});

describe("excecoes do leiaute", () => {
  it("faturamento direto de veiculo novo (tpOp=2) nao soma ST nem FCP-ST", () => {
    const totais = ler(
      montarXml({
        ide: { tpOp: 2 },
        icmsTot: {
          vProd: "80000.00",
          vST: "6000.00",
          vFCPST: "400.00",
          vIPI: "5000.00",
          vNF: "85000.00",
        },
      }),
    );

    assert.equal(totais.indicadores.veiculoNovo, true);
    assert.equal(totais.regra, "VEICULO_NOVO");
    assert.equal(totais.totalCalculado, 85000);
    assert.equal(totais.composicaoValida, true);
    // O ST continua lido e visivel, so nao entrou na conta.
    assert.equal(totais.acrescimos.icmsST, 6000);
  });

  it("nota de importacao que nao fecha marca divergencia prevista, sem alterar valores", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vII: "18.00", vNF: "125.00" },
        itens: [item({ prod: { CFOP: "3102" } })],
      }),
    );

    assert.equal(totais.composicaoValida, false);
    assert.equal(totais.indicadores.importacao, true);
    assert.equal(totais.divergenciaPrevista, true);
    // O vNF do XML permanece intocado; o calculado e reportado ao lado.
    assert.equal(totais.totalNota, 125);
    assert.equal(totais.totalCalculado, 118);
    assert.equal(totais.diferenca, 7);
  });

  it("divergencia numa nota comum e registrada, nunca corrigida em silencio", () => {
    const totais = ler(
      montarXml({ icmsTot: { vProd: "100.00", vOutro: "10.00", vNF: "115.00" } }),
    );

    assert.equal(totais.totalNota, 115);
    assert.equal(totais.totalCalculado, 110);
    assert.equal(totais.diferenca, 5);
    assert.equal(totais.composicaoValida, false);
    assert.equal(totais.divergenciaPrevista, false);
  });

  it("vNFTot e reconhecido e guardado, mas nao vira a referencia do total", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        totalExtra: "<vNFTot>113.00</vNFTot>",
      }),
    );

    assert.equal(totais.indicadores.vNFTot, 113);
    assert.equal(totais.totalNota, 100);
    assert.equal(totais.composicaoValida, true);
  });
});


/* ------------------------------------------------------------------ *
 * Alocação por item
 *
 * A pergunta destes testes não é "esse valor entra no custo?", e sim "esse valor
 * está informado em algum <det>?". Antes de comparar item com total, dizer que o
 * emitente não repartiu um valor é chute — os tributos do item moram em
 * `det/imposto`, não em `det/prod`.
 * ------------------------------------------------------------------ */

function itensDe(xml: string) {
  return lerItensDaNota(lerNFeDoXml(xml).infNFe);
}

function campoDe(totais: TotaisDaNota, campo: string): AlocacaoDeCampo {
  const achado = alocacaoPorItem(totais).find((linha) => linha.campo === campo);
  assert.ok(achado, `campo ${campo} ausente do diagnostico de alocacao`);
  return achado;
}

describe("alocacao dos tributos do item", () => {
  it("1. ICMS-ST informado num unico item fica totalmente alocado", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "300.00", vST: "180.00", vNF: "480.00" },
        itens: [
          item({ nItem: 1, prod: { vUnCom: "100.00", vProd: "100.00" } }),
          item({
            nItem: 2,
            prod: { qCom: "2.0000", vUnCom: "100.00", vProd: "200.00" },
            icms: {
              grupo: "ICMS10",
              campos: { orig: 0, CST: 10, vBCST: "280.00", vICMSST: "180.00" },
            },
          }),
        ],
      }),
    );

    const st = campoDe(totais, "vST");
    assert.equal(st.totalDaNota, 180);
    assert.equal(st.somaDosItens, 180);
    assert.equal(st.naoAlocado, 0);
    assert.equal(st.status, "TOTALMENTE_ALOCADO");
    assert.deepEqual(valoresSemAlocacaoPorItem(totais), []);
  });

  it("2. ICMS-ST distribuido em varios itens soma e fecha com o total", () => {
    const comST = (nItem: number, valor: string) =>
      item({
        nItem,
        icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: valor } },
      });

    const totais = ler(
      montarXml({
        icmsTot: { vProd: "300.00", vST: "180.00", vNF: "480.00" },
        itens: [comST(1, "60.00"), comST(2, "50.00"), comST(3, "70.00")],
      }),
    );

    assert.equal(totais.conferenciaDosItens.icmsST, 180);
    assert.equal(campoDe(totais, "vST").status, "TOTALMENTE_ALOCADO");
  });

  it("3. FCP-ST do item e lido e nao se confunde com vFCP nem vFCPSTRet", () => {
    const totais = ler(
      montarXml({
        icmsTot: {
          vProd: "100.00",
          vST: "20.00",
          vFCPST: "2.60",
          vFCP: "1.00",
          vFCPSTRet: "3.00",
          vNF: "122.60",
        },
        itens: [
          item({
            icms: {
              grupo: "ICMS10",
              campos: {
                orig: 0,
                CST: 10,
                vICMSST: "20.00",
                vFCPST: "2.60",
                vFCP: "1.00",
                vFCPSTRet: "3.00",
              },
            },
          }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.fcpST, 2.6);
    assert.equal(campoDe(totais, "vFCPST").status, "TOTALMENTE_ALOCADO");

    // Item que só tem vFCP e vFCPSTRet não produz FCP-ST nenhum.
    const soInformativos = itensDe(
      montarXml({
        itens: [
          item({
            icms: {
              grupo: "ICMS10",
              campos: { orig: 0, CST: 10, vFCP: "1.00", vFCPSTRet: "3.00" },
            },
          }),
        ],
      }),
    )[0];
    assert.equal(soInformativos.valorFcpST, 0);
    assert.equal(soInformativos.informativos.fcp, 1);
    assert.equal(soInformativos.informativos.fcpSTRet, 3);
  });

  it("4. ICMS desonerado do item e alocado ao item", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "800.00", vICMSDeson: "80.00", vNF: "720.00" },
        itens: [
          item({
            prod: { vUnCom: "800.00", vProd: "800.00" },
            icms: {
              grupo: "ICMS40",
              campos: { orig: 0, CST: 40, vICMSDeson: "80.00", motDesICMS: 9 },
            },
          }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.icmsDesonerado, 80);
    assert.equal(campoDe(totais, "vICMSDeson").status, "TOTALMENTE_ALOCADO");
  });

  it("5. indDeduzDeson e lido; ausente vira null, nunca deducao presumida", () => {
    const comIndicador = (indDeduzDeson?: number) =>
      itensDe(
        montarXml({
          itens: [
            item({
              icms: {
                grupo: "ICMS20",
                campos: { orig: 0, CST: 20, vICMSDeson: "50.00", indDeduzDeson },
              },
            }),
          ],
        }),
      )[0];

    assert.equal(comIndicador(1).deduzIcmsDesonerado, true);
    assert.equal(comIndicador(0).deduzIcmsDesonerado, false);
    // Sem o indicador no XML, a dedução não pode ser afirmada nem negada.
    assert.equal(comIndicador().deduzIcmsDesonerado, null);
  });

  it("6. ICMS monofasico sujeito a retencao informado no item fica alocado", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vICMSMonoReten: "15.00", vNF: "115.00" },
        itens: [
          item({
            icms: {
              grupo: "ICMS61",
              campos: {
                orig: 0,
                CST: 61,
                qBCMonoReten: "10.0000",
                vICMSMonoReten: "15.00",
              },
            },
          }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.icmsMonoReten, 15);
    assert.equal(campoDe(totais, "vICMSMonoReten").status, "TOTALMENTE_ALOCADO");
    assert.deepEqual(valoresSemAlocacaoPorItem(totais), []);
  });

  it("7. ICMS monofasico so no total e o unico caso de valor sem alocacao", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vICMSMonoReten: "15.00", vNF: "115.00" },
      }),
    );

    const mono = campoDe(totais, "vICMSMonoReten");
    assert.equal(mono.totalDaNota, 15);
    assert.equal(mono.somaDosItens, 0);
    assert.equal(mono.naoAlocado, 15);
    assert.equal(mono.status, "SEM_ALOCACAO");

    const semDono = valoresSemAlocacaoPorItem(totais);
    assert.equal(semDono.length, 1);
    assert.equal(semDono[0].rotulo, "ICMS mono. retido");
  });

  it("8. imposto de importacao do item e alocado", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "500.00", vII: "40.00", vNF: "540.00" },
        itens: [
          item({
            prod: { CFOP: "3102", vUnCom: "500.00", vProd: "500.00" },
            ii: { vBC: "500.00", vII: "40.00", vDespAdu: "0.00", vIOF: "0.00" },
          }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.impostoImportacao, 40);
    assert.equal(campoDe(totais, "vII").status, "TOTALMENTE_ALOCADO");
  });

  it("9. IPI do item e alocado", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "500.00", vIPI: "50.00", vNF: "550.00" },
        itens: [
          item({
            prod: { vUnCom: "500.00", vProd: "500.00" },
            ipi: { CST: 50, vBC: "500.00", pIPI: "10.0000", vIPI: "50.00" },
          }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.ipi, 50);
    assert.equal(campoDe(totais, "vIPI").status, "TOTALMENTE_ALOCADO");
  });

  it("10. IPI devolvido vive em det/impostoDevol e pertence aquele item", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "700.00", vIPIDevol: "25.00", vNF: "725.00" },
        itens: [
          item({
            prod: { vUnCom: "700.00", vProd: "700.00" },
            impostoDevol: { vIPIDevol: "25.00" },
          }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.ipiDevolvido, 25);
    assert.equal(campoDe(totais, "vIPIDevol").status, "TOTALMENTE_ALOCADO");
  });

  it("11. PIS-ST do item so conta como alocado quando compoe o total", () => {
    const compoe = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "112.00" },
        itens: [item({ pisST: { vBC: "100.00", vPIS: "12.00", indSomaPISST: 1 } })],
      }),
    );
    assert.equal(compoe.conferenciaDosItens.pisST, 12);
    assert.equal(campoDe(compoe, "PISST/vPIS").status, "TOTALMENTE_ALOCADO");

    const naoCompoe = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        itens: [item({ pisST: { vBC: "100.00", vPIS: "12.00", indSomaPISST: 0 } })],
      }),
    );
    assert.equal(naoCompoe.conferenciaDosItens.pisST, 0);
    assert.equal(campoDe(naoCompoe, "PISST/vPIS").status, "AUSENTE");
    // O valor continua legível no item, só não compõe nem reconcilia.
    assert.equal(itensDe(
      montarXml({
        itens: [item({ pisST: { vBC: "100.00", vPIS: "12.00", indSomaPISST: 0 } })],
      }),
    )[0].pisST.valor, 12);
  });

  it("12. COFINS-ST do item nao se confunde com o COFINS normal", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vCOFINS: "7.60", vNF: "124.00" },
        itens: [
          item({ cofinsST: { vBC: "100.00", vCOFINS: "24.00", indSomaCOFINSST: 1 } }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.cofinsST, 24);
    assert.equal(campoDe(totais, "COFINSST/vCOFINS").status, "TOTALMENTE_ALOCADO");
    assert.equal(totais.informativos.cofins, 7.6);
  });

  it("13. frete por item fica alocado", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "200.00", vFrete: "30.00", vNF: "230.00" },
        itens: [
          item({ nItem: 1, prod: { vFrete: "18.00" } }),
          item({ nItem: 2, prod: { vFrete: "12.00" } }),
        ],
      }),
    );
    assert.equal(campoDe(totais, "vFrete").status, "TOTALMENTE_ALOCADO");
  });

  it("14. seguro por item fica alocado", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vSeg: "10.00", vNF: "110.00" },
        itens: [item({ prod: { vSeg: "10.00" } })],
      }),
    );
    assert.equal(campoDe(totais, "vSeg").status, "TOTALMENTE_ALOCADO");
  });

  it("15. outras despesas por item ficam alocadas", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vOutro: "20.00", vNF: "120.00" },
        itens: [item({ prod: { vOutro: "20.00" } })],
      }),
    );
    assert.equal(campoDe(totais, "vOutro").status, "TOTALMENTE_ALOCADO");
  });

  it("16. desconto por item fica alocado", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vDesc: "50.00", vNF: "50.00" },
        itens: [item({ prod: { vDesc: "50.00" } })],
      }),
    );
    assert.equal(campoDe(totais, "vDesc").status, "TOTALMENTE_ALOCADO");
  });

  it("17. total igual a soma dos itens: nada fica sem alocacao", () => {
    const totais = ler(
      montarXml({
        icmsTot: {
          vProd: "300.00",
          vFrete: "30.00",
          vST: "20.00",
          vIPI: "10.00",
          vNF: "360.00",
        },
        itens: [
          item({
            nItem: 1,
            prod: { vUnCom: "100.00", vProd: "100.00", vFrete: "30.00" },
            ipi: { vIPI: "10.00" },
          }),
          item({
            nItem: 2,
            prod: { qCom: "2.0000", vUnCom: "100.00", vProd: "200.00" },
            icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "20.00" } },
          }),
        ],
      }),
    );

    assert.deepEqual(valoresSemAlocacaoPorItem(totais), []);
    assert.equal(totais.composicaoValida, true);
  });

  it("18. total diferente da soma dos itens acusa a parte nao alocada", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vFrete: "30.00", vNF: "130.00" },
        itens: [item({ prod: { vFrete: "18.00" } })],
      }),
    );

    const frete = campoDe(totais, "vFrete");
    assert.equal(frete.totalDaNota, 30);
    assert.equal(frete.somaDosItens, 18);
    assert.equal(frete.naoAlocado, 12);
    assert.equal(frete.status, "PARCIALMENTE_ALOCADO");
  });

  it("19. um centavo e arredondamento do emissor; dois centavos e divergencia", () => {
    const umCentavo = ler(
      montarXml({
        icmsTot: { vProd: "100.01", vNF: "100.01" },
        itens: [item({ prod: { vProd: "100.00", vUnCom: "100.00" } })],
      }),
    );
    assert.equal(campoDe(umCentavo, "vProd").status, "TOTALMENTE_ALOCADO");

    const doisCentavos = ler(
      montarXml({
        icmsTot: { vProd: "100.02", vNF: "100.02" },
        itens: [item({ prod: { vProd: "100.00", vUnCom: "100.00" } })],
      }),
    );
    assert.equal(campoDe(doisCentavos, "vProd").status, "PARCIALMENTE_ALOCADO");
    assert.equal(campoDe(doisCentavos, "vProd").naoAlocado, 0.02);
  });

  it("20. varios CSTs de ICMS na mesma nota, sem depender do nome do grupo", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "400.00", vST: "90.00", vICMSDeson: "15.00", vNF: "475.00" },
        itens: [
          item({
            nItem: 1,
            icms: { grupo: "ICMS00", campos: { orig: 0, CST: "00", vICMS: "18.00" } },
          }),
          item({
            nItem: 2,
            icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "40.00" } },
          }),
          item({
            nItem: 3,
            icms: {
              grupo: "ICMS70",
              campos: { orig: 0, CST: 70, vICMSST: "50.00", vICMSDeson: "15.00" },
            },
          }),
          item({ nItem: 4, icms: { grupo: "ICMS90", campos: { orig: 0, CST: 90 } } }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.icmsST, 90);
    assert.equal(totais.conferenciaDosItens.icmsDesonerado, 15);
    assert.equal(campoDe(totais, "vST").status, "TOTALMENTE_ALOCADO");
    assert.equal(campoDe(totais, "vICMSDeson").status, "TOTALMENTE_ALOCADO");
  });

  it("21. varios CSOSNs do Simples, idem", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "400.00", vST: "75.00", vNF: "475.00" },
        itens: [
          item({
            nItem: 1,
            icms: { grupo: "ICMSSN101", campos: { orig: 0, CSOSN: 101 } },
          }),
          item({
            nItem: 2,
            icms: {
              grupo: "ICMSSN201",
              campos: { orig: 0, CSOSN: 201, vICMSST: "30.00" },
            },
          }),
          item({
            nItem: 3,
            icms: {
              grupo: "ICMSSN202",
              campos: { orig: 0, CSOSN: 202, vICMSST: "20.00" },
            },
          }),
          item({
            nItem: 4,
            icms: {
              grupo: "ICMSSN900",
              campos: { orig: 0, CSOSN: 900, vICMSST: "25.00" },
            },
          }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.icmsST, 75);
    assert.equal(campoDe(totais, "vST").status, "TOTALMENTE_ALOCADO");
  });

  it("22. item sem grupo tributario nenhum nao quebra a leitura", () => {
    const itens = itensDe(
      `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe">` +
        `<infNFe versao="4.00"><det nItem="1"><prod><cProd>X</cProd><vProd>10.00</vProd>` +
        `<qCom>1.0000</qCom><vUnCom>10.00</vUnCom></prod></det>` +
        `<total><ICMSTot><vProd>10.00</vProd><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe>`,
    );

    assert.equal(itens.length, 1);
    assert.equal(itens[0].valorIcmsST, 0);
    assert.equal(itens[0].valorII, 0);
    assert.equal(itens[0].valorIpiDevolvido, 0);
    assert.equal(itens[0].pisST.compoeTotal, false);
    assert.equal(itens[0].deduzIcmsDesonerado, null);
    assert.equal(itens[0].icms, null);
  });

  it("23. campos tributarios zerados no item nao viram alocacao fantasma", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vNF: "100.00" },
        itens: [
          item({
            prod: { vDesc: "0.00", vFrete: "0.00", vSeg: "0.00", vOutro: "0.00" },
            icms: {
              grupo: "ICMS10",
              campos: { orig: 0, CST: 10, vICMSST: "0.00", vFCPST: "0.00" },
            },
            ipi: { vIPI: "0.00" },
          }),
        ],
      }),
    );

    for (const campo of alocacaoPorItem(totais)) {
      if (campo.campo === "vProd") continue;
      assert.equal(campo.status, "AUSENTE", `${campo.campo} deveria estar ausente`);
    }
    assert.deepEqual(valoresSemAlocacaoPorItem(totais), []);
  });

  it("24. namespace oficial da NF-e nao atrapalha a leitura por item", () => {
    const totais = ler(
      montarXml({
        comPrefixoDeNamespace: true,
        icmsTot: { vProd: "100.00", vST: "20.00", vNF: "120.00" },
        itens: [
          item({
            icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "20.00" } },
          }),
        ],
      }),
    );

    assert.equal(totais.conferenciaDosItens.icmsST, 20);
    assert.equal(campoDe(totais, "vST").status, "TOTALMENTE_ALOCADO");
  });

  it("25. dentro de nfeProc a leitura por item e a mesma", () => {
    const totais = ler(
      montarXml({
        envelope: "nfeProc",
        icmsTot: { vProd: "100.00", vIPI: "10.00", vNF: "110.00" },
        itens: [item({ ipi: { vIPI: "10.00" } })],
      }),
    );

    assert.equal(totais.conferenciaDosItens.ipi, 10);
    assert.equal(campoDe(totais, "vIPI").status, "TOTALMENTE_ALOCADO");
  });
});

describe("item e total sao a mesma coisa contada uma vez", () => {
  it("o total compoe; a soma dos itens so reconcilia", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "300.00", vST: "20.00", vIPI: "10.00", vNF: "330.00" },
        itens: [
          item({
            nItem: 1,
            prod: { vUnCom: "100.00", vProd: "100.00" },
            ipi: { vIPI: "10.00" },
          }),
          item({
            nItem: 2,
            prod: { qCom: "2.0000", vUnCom: "100.00", vProd: "200.00" },
            icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "20.00" } },
          }),
        ],
      }),
    );

    // Somar item + total daria 360,00: o ST e o IPI entrariam duas vezes.
    assert.equal(totais.totalCalculado, 330);
    assert.equal(totais.acrescimos.icmsST, 20);
    assert.equal(totais.conferenciaDosItens.icmsST, 20);
    assert.equal(totais.acrescimos.ipi, 10);
    assert.equal(totais.conferenciaDosItens.ipi, 10);
  });
});

describe("custo da linha x valor da NF-e", () => {
  it("um ST alocado ao item continua fora da formula de custo, e a tela diz isso", () => {
    const totais = ler(
      montarXml({
        icmsTot: { vProd: "100.00", vST: "22.00", vNF: "122.00" },
        itens: [
          item({
            icms: { grupo: "ICMS10", campos: { orig: 0, CST: 10, vICMSST: "22.00" } },
          }),
        ],
      }),
    );

    // Alocado: nada a reclamar sobre o XML.
    assert.deepEqual(valoresSemAlocacaoPorItem(totais), []);

    // Mas continua fora do custo da linha — e o componente diz que está no item.
    const fora = componentesForaDoCustoDaLinha(totais);
    const st = fora.acrescimos.find((parte) => parte.campo === "vST");
    assert.ok(st);
    assert.equal(st.valor, 22);
    assert.equal(st.alocadoNosItens, 22);
    assert.equal(st.semAlocacao, 0);
    assert.equal(fora.total, 22);
  });

  it("a fixture completa: custo das linhas + fora do custo = vNF, e so o mono fica sem alocacao", () => {
    const xml = montarXml({
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
        vNF: "5296.00",
      },
      itens: [
        item({
          nItem: 1,
          prod: {
            vUnCom: "1000.00",
            vProd: "1000.00",
            vFrete: "30.00",
            vSeg: "10.00",
            vDesc: "50.00",
            vOutro: "20.00",
          },
          icms: { grupo: "ICMS00", campos: { orig: 0, CST: "00", vICMS: "180.00" } },
          pisST: { vBC: "1000.00", vPIS: "12.00", indSomaPISST: 1 },
          cofinsST: { vBC: "1000.00", vCOFINS: "24.00", indSomaCOFINSST: 1 },
        }),
        item({
          nItem: 2,
          prod: { qCom: "2.0000", vUnCom: "1000.00", vProd: "2000.00" },
          icms: {
            grupo: "ICMS10",
            campos: { orig: 0, CST: 10, vICMSST: "180.00", vFCPST: "20.00" },
          },
        }),
        item({
          nItem: 3,
          prod: { CFOP: "3202", vUnCom: "500.00", vProd: "500.00" },
          ipi: { CST: 50, vIPI: "50.00" },
          ii: { vBC: "500.00", vII: "40.00" },
        }),
        item({
          nItem: 4,
          prod: { vUnCom: "800.00", vProd: "800.00" },
          icms: {
            grupo: "ICMS40",
            campos: { orig: 0, CST: 40, vICMSDeson: "80.00", motDesICMS: 9 },
          },
        }),
        item({
          nItem: 5,
          prod: { vUnCom: "700.00", vProd: "700.00" },
          impostoDevol: { vIPIDevol: "25.00" },
        }),
      ],
    });

    const totais = ler(xml);
    assert.equal(totais.totalNota, 5296);
    assert.equal(totais.totalCalculado, 5296);
    assert.equal(totais.composicaoValida, true);

    // Só o ICMS monofásico retido foi declarado apenas no total. Todo o resto
    // está dentro de um <det> — dizer que "o emitente não repartiu" seria falso.
    const semAlocacao = valoresSemAlocacaoPorItem(totais);
    assert.equal(semAlocacao.length, 1);
    assert.equal(semAlocacao[0].campo, "vICMSMonoReten");
    assert.equal(semAlocacao[0].naoAlocado, 15);

    // A distância entre custo e vNF é outra conta, e ela fecha.
    const custoDosItens = custoDasLinhas(xml);
    assert.equal(custoDosItens, 5060);
    const fora = componentesForaDoCustoDaLinha(totais);
    assert.equal(fora.total, 236);
    assert.equal(custoDosItens + fora.total, totais.totalNota);

    // E cada componente sabe se está no item ou só no total.
    const porCampo = new Map(
      [...fora.acrescimos, ...fora.reducoes].map((parte) => [parte.campo, parte]),
    );
    assert.equal(porCampo.get("vST")?.alocadoNosItens, 180);
    assert.equal(porCampo.get("vST")?.semAlocacao, 0);
    assert.equal(porCampo.get("vICMSMonoReten")?.alocadoNosItens, 0);
    assert.equal(porCampo.get("vICMSMonoReten")?.semAlocacao, 15);
    assert.equal(porCampo.get("vICMSDeson")?.alocadoNosItens, 80);
    assert.equal(porCampo.get("vFrete"), undefined);
  });

  it("no faturamento direto de veiculo novo o ST fica fora da conta toda", () => {
    const totais = ler(
      montarXml({
        ide: { tpOp: 2 },
        icmsTot: {
          vProd: "80000.00",
          vST: "6000.00",
          vFCPST: "400.00",
          vIPI: "5000.00",
          vNF: "85000.00",
        },
      }),
    );

    assert.equal(componentesDoTotal(totais).icmsST, 0);
    const fora = componentesForaDoCustoDaLinha(totais);
    assert.equal(fora.acrescimos.find((parte) => parte.campo === "vST"), undefined);
    assert.equal(fora.acrescimos.find((parte) => parte.campo === "vIPI")?.valor, 5000);
    // O valor continua legível, só não entra em conta nenhuma.
    assert.equal(totais.acrescimos.icmsST, 6000);
  });
});
