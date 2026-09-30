import assert from "node:assert/strict";
import test from "node:test";

import { EXTRATO_C6_15_09, EXTRATO_SGML, EXTRATO_XML } from "./fixtures";
import { decodificarOfx, parseOfx, saldoInicialCentavos } from "./parser";
import { parseDataOfx, parseValorParaCentavos } from "./normalize";
import { ErroDeOfx } from "./types";

test("lê o cabeçalho da conta de um OFXSGML", () => {
  const extrato = parseOfx(EXTRATO_SGML);

  assert.equal(extrato.cabecalho.bankId, "104");
  assert.equal(extrato.cabecalho.branchId, "1234");
  assert.equal(extrato.cabecalho.acctId, "000012345-6");
  assert.equal(extrato.cabecalho.acctType, "CHECKING");
  assert.equal(extrato.cabecalho.moeda, "BRL");
  assert.equal(extrato.cabecalho.periodoInicio, "2026-08-01");
  assert.equal(extrato.cabecalho.periodoFim, "2026-08-31");
  assert.equal(extrato.cabecalho.saldoFinalCentavos, 1_234_569);
});

test("o período contém os movimentos quando o banco declara outro", () => {
  // O C6 escreve em DTSTART e DTEND o instante da exportação. O histórico
  // mostraria "15/09 → 15/09" para um extrato que começa em 31/08.
  const extrato = parseOfx(EXTRATO_C6_15_09);

  assert.equal(extrato.cabecalho.periodoInicio, "2026-08-31");
  assert.equal(extrato.cabecalho.periodoFim, "2026-09-15");
  assert.equal(extrato.cabecalho.saldoFinalCentavos, null);
});

test("lê todos os movimentos, com créditos e débitos", () => {
  const { movimentos } = parseOfx(EXTRATO_SGML);

  assert.equal(movimentos.length, 10);
  assert.equal(movimentos[0].valorCentavos, 97_000);
  assert.equal(movimentos[1].valorCentavos, -411_800);
  assert.equal(movimentos.filter((movimento) => movimento.valorCentavos > 0).length, 2);
  assert.equal(movimentos.filter((movimento) => movimento.valorCentavos < 0).length, 8);
});

test("a data do movimento é o dia local declarado, sem conversão de fuso", () => {
  // 20260803120000[-3:BRT] é 3 de agosto para quem opera a oficina. Converter
  // para UTC e voltar é o caminho que faz o movimento andar um dia.
  const { movimentos } = parseOfx(EXTRATO_SGML);
  assert.equal(movimentos[1].dataPostagem, "2026-08-03");
});

test("guarda MEMO, NAME, CHECKNUM e DTAVAIL quando o banco envia", () => {
  const { movimentos } = parseOfx(EXTRATO_SGML);

  assert.equal(movimentos[3].nome, "FORNECEDOR XYZ LTDA");
  assert.equal(movimentos[3].memo, "PAGAMENTO DE BOLETO");
  assert.equal(movimentos[9].checknum, "778812");
  assert.equal(movimentos[9].dataDisponivel, "2026-08-16");
});

test("tags ausentes viram null, não quebram a leitura", () => {
  const { movimentos } = parseOfx(EXTRATO_SGML);

  assert.equal(movimentos[0].nome, null);
  assert.equal(movimentos[0].checknum, null);
  assert.equal(movimentos[0].refnum, null);
  assert.equal(movimentos[0].dataDisponivel, null);
});

test("o mesmo FITID aparece em movimentos diferentes", () => {
  // É o caso real que impede usar FITID como chave: duas linhas do mesmo dia,
  // de valores diferentes, compartilhando o identificador.
  const { movimentos } = parseOfx(EXTRATO_SGML);

  assert.equal(movimentos[1].fitid, "202608030001");
  assert.equal(movimentos[2].fitid, "202608030001");
  assert.notEqual(movimentos[1].valorCentavos, movimentos[2].valorCentavos);
});

test("lê o dialeto XML com as tags fechadas", () => {
  const extrato = parseOfx(EXTRATO_XML);

  assert.equal(extrato.cabecalho.bankId, "341");
  assert.equal(extrato.cabecalho.acctId, "98765-4");
  assert.equal(extrato.movimentos.length, 1);
  assert.equal(extrato.movimentos[0].valorCentavos, -25_035);
  assert.equal(extrato.movimentos[0].memo, "TED ENVIADA JOAO & CIA");
});

test("deduz o saldo inicial a partir do final", () => {
  const extrato = parseOfx(EXTRATO_SGML);
  assert.equal(saldoInicialCentavos(extrato), 2_002_890);
});

test("recusa arquivo que não é OFX e extrato sem movimento", () => {
  assert.throws(() => parseOfx("relatorio;csv;sem;tags"), ErroDeOfx);
  assert.throws(
    () => parseOfx("<OFX>\n<BANKMSGSRSV1>\n</BANKMSGSRSV1>\n</OFX>"),
    ErroDeOfx,
  );
});

test("descarta o movimento sem data ou sem valor, e mantém o resto", () => {
  const comLinhaQuebrada = EXTRATO_SGML.replace(
    "<TRNAMT>-18.44\n",
    "",
  );
  const { movimentos } = parseOfx(comLinhaQuebrada);
  assert.equal(movimentos.length, 9);
});

test("decodifica arquivo em Windows-1252 sem perder o texto", () => {
  // 0xC7 e 0xC3 são Ç e Ã na tabela 1252 e byte inválido em UTF-8: é
  // exatamente o caso em que a leitura otimista falha e o fallback entra.
  const bytes = Uint8Array.from([
    ...Buffer.from("<OFX><MEMO>SERVI", "latin1"),
    0xc7,
    ...Buffer.from("OS</MEMO></OFX>", "latin1"),
  ]);
  assert.equal(decodificarOfx(bytes), "<OFX><MEMO>SERVIÇOS</MEMO></OFX>");
});

test("normaliza data OFX em vários formatos", () => {
  assert.equal(parseDataOfx("20260803120000[-3:BRT]"), "2026-08-03");
  assert.equal(parseDataOfx("20260803"), "2026-08-03");
  assert.equal(parseDataOfx("20260803120000.000[-03:EST]"), "2026-08-03");
  assert.equal(parseDataOfx(""), null);
  assert.equal(parseDataOfx("20261303"), null);
});

test("valores viram centavos inteiros nos dois padrões de separador", () => {
  assert.equal(parseValorParaCentavos("-5835.69"), -583_569);
  assert.equal(parseValorParaCentavos("-5835,69"), -583_569);
  assert.equal(parseValorParaCentavos("1.234,56"), 123_456);
  assert.equal(parseValorParaCentavos("970.00"), 97_000);
  assert.equal(parseValorParaCentavos("0.10"), 10);
  assert.equal(parseValorParaCentavos("-0.01"), -1);
  assert.equal(parseValorParaCentavos(""), null);
  assert.equal(parseValorParaCentavos(null), null);
});

test("centavos não passam por ponto flutuante", () => {
  // 0.1 + 0.2 é o motivo de a conta ser feita em texto: somando os centavos de
  // três décimos o resultado tem que ser exatamente 30.
  const soma =
    (parseValorParaCentavos("0.10") ?? 0) +
    (parseValorParaCentavos("0.20") ?? 0);
  assert.equal(soma, 30);
  assert.equal(parseValorParaCentavos("1234.565"), 123_457);
});
