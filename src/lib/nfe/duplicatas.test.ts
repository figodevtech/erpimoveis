import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser } from "fast-xml-parser";

import { centavosDaDuplicata, distribuirDuplicatasIgualmente, dividirDuplicatasIgualmente, extrairCobranca, numeroDaDuplicata, resolverCobrancaNFe, totalDasDuplicatas } from "./duplicatas";

test("divide igualmente em centavos e distribui o resto desde a primeira parcela", () => {
  assert.deepEqual(distribuirDuplicatasIgualmente(3910, 2), [195500, 195500]);
  assert.deepEqual(distribuirDuplicatasIgualmente(0.01, 1), [1]);
  assert.deepEqual(distribuirDuplicatasIgualmente(0.02, 2), [1, 1]);
  assert.deepEqual(distribuirDuplicatasIgualmente(0.03, 2), [2, 1]);
  assert.deepEqual(distribuirDuplicatasIgualmente(100, 3), [3334, 3333, 3333]);
  assert.throws(() => distribuirDuplicatasIgualmente(0.01, 2), RangeError);
  assert.throws(() => distribuirDuplicatasIgualmente(0.01, 3), RangeError);
  for (const quantidade of [1, 2, 3, 7, 120]) {
    for (const valor of [quantidade / 100, 100, 3910, 1234.57]) {
      const parcelas = distribuirDuplicatasIgualmente(valor, quantidade);
      assert.equal(parcelas.length, quantidade);
      assert.ok(parcelas.every((centavos) => Number.isInteger(centavos) && centavos > 0));
      assert.equal(parcelas.reduce((soma, centavos) => soma + centavos, 0), centavosDaDuplicata(valor));
    }
  }
  assert.throws(() => distribuirDuplicatasIgualmente(100, 121), RangeError);
});

test("divisão preserva vencimentos, quantidade e numeração automática", () => {
  const antes = [
    { numero: "999", vencimento: "2026-10-25", valor: 1 },
    { numero: "999", vencimento: "2026-11-25", valor: 2 },
    { numero: "999", vencimento: "2026-12-25", valor: 3 },
  ];
  const depois = dividirDuplicatasIgualmente(antes, 100);
  assert.deepEqual(depois.map((item) => item.vencimento), antes.map((item) => item.vencimento));
  assert.deepEqual(depois.map((item) => item.numero), ["001", "002", "003"]);
  assert.deepEqual(depois.map((item) => centavosDaDuplicata(item.valor)), [3334, 3333, 3333]);
  assert.deepEqual(antes.map((item) => item.valor), [1, 2, 3]);
});

const cobrar = (params: Partial<Parameters<typeof resolverCobrancaNFe>[0]> = {}) => resolverCobrancaNFe({
  modelo: 55,
  finNFe: 1,
  pagamentos: [{ tPag: "14", valor: 100 }],
  cobranca: { duplicatas: [{ vencimento: "2026-10-25", valor: 100 }] },
  valorNota: 100,
  ...params,
});

test("emissão numera e soma duplicatas em centavos", () => {
  assert.equal(numeroDaDuplicata(9), "010");
  const result = cobrar({
    cobranca: { duplicatas: [
      { numero: "999", vencimento: "2026-10-25", valor: 33.34 },
      { numero: "999", vencimento: "2026-11-25", valor: 33.33 },
      { numero: "999", vencimento: "2026-12-25", valor: 33.33 },
    ] },
  });
  assert.deepEqual(result.erros, []);
  assert.equal(result.cobranca?.totalCentavos, 10000);
  assert.deepEqual(result.cobranca?.duplicatas.map((item) => item.numero), ["001", "002", "003"]);
});

test("emissão bloqueia soma, data, valor e quantidade inválidos", () => {
  assert.match(cobrar({ cobranca: { duplicatas: [{ vencimento: "2026-10-25", valor: 90 }] } }).erros.join(" "), /soma das duplicatas/);
  assert.match(cobrar({ cobranca: { duplicatas: [{ vencimento: "", valor: 100 }] } }).erros.join(" "), /vencimento da duplicata 001/);
  assert.match(cobrar({ cobranca: { duplicatas: [{ vencimento: "2026-02-29", valor: 100 }] } }).erros.join(" "), /data válida/);
  assert.match(cobrar({ cobranca: { duplicatas: [{ vencimento: "2028-02-29", valor: 100 }] } }).erros.join(" "), /^$/);
  for (const valor of [0, -1]) {
    assert.match(cobrar({ cobranca: { duplicatas: [{ vencimento: "2026-10-25", valor }] } }).erros.join(" "), /maior que zero/);
  }
  assert.match(cobrar({ cobranca: { duplicatas: [
    { vencimento: "2026-11-25", valor: 50 },
    { vencimento: "2026-10-25", valor: 50 },
  ] } }).erros.join(" "), /não pode ser anterior/);
  assert.match(cobrar({ cobranca: { duplicatas: Array.from({ length: 121 }, () => ({ vencimento: "2026-10-25", valor: 1 })) } }).erros.join(" "), /no máximo 120/);
  assert.deepEqual(cobrar({
    pagamentos: [{ tPag: "14", valor: 120 }],
    cobranca: { duplicatas: Array.from({ length: 120 }, () => ({ vencimento: "2026-10-25", valor: 1 })) },
  }).erros, []);
});

test("emissão exige tPag 14 e dup juntos, somente na NF-e com finalidade compatível", () => {
  assert.match(cobrar({ cobranca: null }).erros.join(" "), /exige ao menos uma duplicata/);
  assert.match(cobrar({ pagamentos: [{ tPag: "15", valor: 100 }] }).erros.join(" "), /só pode ser informado/);
  assert.match(cobrar({ modelo: 65 }).erros.join(" "), /NFC-e/);
  assert.match(cobrar({ finNFe: 4 }).erros.join(" "), /finalidade/);
  assert.equal(cobrar({ pagamentos: [{ tPag: "15", valor: 100 }], cobranca: null }).cobranca, null);
  assert.deepEqual(cobrar({ pagamentos: [{ tPag: "17", valor: 50 }, { tPag: "14", valor: 50 }], cobranca: { duplicatas: [{ vencimento: "2026-10-25", valor: 50 }] } }).erros, []);
});

/**
 * Passa pelo mesmo parser da rota de entrada: é ele que decide se `119.00` chega
 * como número e se `001` continua texto. Testar contra um objeto montado à mão
 * esconderia justamente essas conversões.
 */
function infNFeDe(cobrXml: string) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const json = parser.parse(
    `<NFe><infNFe><ide><nNF>1</nNF></ide>${cobrXml}</infNFe></NFe>`,
  );
  return json.NFe.infNFe;
}

test("lê fatura e duplicatas de uma nota parcelada", () => {
  const cobranca = extrairCobranca(
    infNFeDe(`
      <cobr>
        <fat><nFat>012345</nFat><vOrig>1000.00</vOrig><vDesc>0.00</vDesc><vLiq>1000.00</vLiq></fat>
        <dup><nDup>001</nDup><dVenc>2026-09-10</dVenc><vDup>333.34</vDup></dup>
        <dup><nDup>002</nDup><dVenc>2026-10-10</dVenc><vDup>333.33</vDup></dup>
        <dup><nDup>003</nDup><dVenc>2026-11-10</dVenc><vDup>333.33</vDup></dup>
      </cobr>`),
  );

  // "012345" chega como 12345: o parser da rota converte o que parece número e
  // come o zero à esquerda. O rótulo é informativo, então o que importa é não
  // quebrar — a parcela sai de vencimento e valor.
  assert.equal(cobranca.fatura?.numero, "12345");
  assert.equal(cobranca.fatura?.valorLiquido, 1000);
  assert.equal(cobranca.duplicatas.length, 3);
  assert.deepEqual(cobranca.duplicatas[0], {
    numero: "1",
    vencimento: "2026-09-10",
    valor: 333.34,
  });
  assert.equal(totalDasDuplicatas(cobranca.duplicatas), 100000);
});

test("duplicata única não vem em array e mesmo assim é lida", () => {
  const cobranca = extrairCobranca(
    infNFeDe(
      `<cobr><fat><nFat>5</nFat><vOrig>119</vOrig><vDesc>0</vDesc><vLiq>119</vLiq></fat>` +
        `<dup><nDup>1</nDup><dVenc>2026-08-19</dVenc><vDup>119</vDup></dup></cobr>`,
    ),
  );

  assert.equal(cobranca.duplicatas.length, 1);
  assert.equal(cobranca.duplicatas[0].valor, 119);
  assert.equal(cobranca.duplicatas[0].vencimento, "2026-08-19");
});

test("nota sem grupo de cobrança não inventa parcela", () => {
  const cobranca = extrairCobranca(infNFeDe(""));

  assert.equal(cobranca.fatura, null);
  assert.deepEqual(cobranca.duplicatas, []);
  assert.equal(totalDasDuplicatas(cobranca.duplicatas), 0);
});

test("cobrança só com fatura, sem duplicata, é lida sem quebrar", () => {
  const cobranca = extrairCobranca(
    infNFeDe(`<cobr><fat><nFat>7</nFat><vOrig>50</vOrig><vLiq>50</vLiq></fat></cobr>`),
  );

  assert.equal(cobranca.fatura?.numero, "7");
  assert.equal(cobranca.fatura?.desconto, null);
  assert.deepEqual(cobranca.duplicatas, []);
});

test("valor com vírgula vira número", () => {
  const cobranca = extrairCobranca(
    infNFeDe(`<cobr><dup><nDup>1</nDup><dVenc>2026-09-01</dVenc><vDup>1.234,56</vDup></dup></cobr>`),
  );

  // "1.234,56" não é número válido nem com a vírgula trocada: o parser devolve
  // texto, e o valor cai fora em vez de virar um número errado.
  assert.deepEqual(cobranca.duplicatas, []);
});

test("vencimento com hora colada não anda um dia", () => {
  const cobranca = extrairCobranca(
    infNFeDe(
      `<cobr><dup><nDup>1</nDup><dVenc>2026-09-01T00:00:00-03:00</dVenc><vDup>10</vDup></dup></cobr>`,
    ),
  );

  assert.equal(cobranca.duplicatas[0].vencimento, "2026-09-01");
});

test("duplicata zerada não vira parcela", () => {
  const cobranca = extrairCobranca(
    infNFeDe(
      `<cobr><dup><nDup>1</nDup><dVenc>2026-09-01</dVenc><vDup>0</vDup></dup>` +
        `<dup><nDup>2</nDup><dVenc>2026-10-01</dVenc><vDup>80</vDup></dup></cobr>`,
    ),
  );

  assert.equal(cobranca.duplicatas.length, 1);
  assert.equal(cobranca.duplicatas[0].numero, "2");
});

test("NF-e real, com namespace e dez duplicatas, é lida inteira", () => {
  // O XML de verdade declara xmlns no elemento raiz e Id em infNFe. O parser
  // mantém o nome da tag (o namespace é o padrão, sem prefixo), mas isso é
  // comportamento dele, não garantia nossa — daí o teste.
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const dups = Array.from({ length: 10 }, (_, indice) => {
    const mes = String(((7 + indice) % 12) + 1).padStart(2, "0");
    const ano = 2026 + Math.floor((7 + indice) / 12);
    return `<dup><nDup>${String(indice + 1).padStart(3, "0")}</nDup><dVenc>${ano}-${mes}-20</dVenc><vDup>450.00</vDup></dup>`;
  }).join("");

  const json = parser.parse(
    `<?xml version="1.0" encoding="UTF-8"?>
     <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
       <infNFe versao="4.00" Id="NFe25260812345678000190550010000001231123456785">
         <cobr>
           <fat><nFat>FAT-000123</nFat><vOrig>5000.00</vOrig><vDesc>500.00</vDesc><vLiq>4500.00</vLiq></fat>
           ${dups}
         </cobr>
       </infNFe>
     </NFe>`,
  );

  const cobranca = extrairCobranca(json.NFe.infNFe);

  assert.equal(cobranca.fatura?.numero, "FAT-000123");
  assert.equal(cobranca.fatura?.valorLiquido, 4500);
  assert.equal(cobranca.duplicatas.length, 10);
  assert.equal(cobranca.duplicatas[0].vencimento, "2026-08-20");
  assert.equal(cobranca.duplicatas[9].vencimento, "2027-05-20");
  // Fecha com o vLiq da fatura, que é o vNF da nota.
  assert.equal(totalDasDuplicatas(cobranca.duplicatas), 450000);
});

test("duplicata sem vencimento é lida, mas fica sem data", () => {
  const cobranca = extrairCobranca(
    infNFeDe(`<cobr><dup><nDup>1</nDup><vDup>40</vDup></dup></cobr>`),
  );

  assert.equal(cobranca.duplicatas.length, 1);
  assert.equal(cobranca.duplicatas[0].vencimento, null);
});
