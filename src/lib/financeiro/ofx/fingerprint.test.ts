import assert from "node:assert/strict";
import test from "node:test";

import { calcularFingerprints, chaveBaseDoMovimento, hashDoArquivo } from "./fingerprint";
import { EXTRATO_C6_15_09, EXTRATO_C6_22_09, EXTRATO_SGML } from "./fixtures";
import { parseOfx } from "./parser";

const extrato = parseOfx(EXTRATO_SGML);

test("a mesma leitura do mesmo arquivo gera os mesmos fingerprints", () => {
  const primeira = calcularFingerprints(parseOfx(EXTRATO_SGML));
  const segunda = calcularFingerprints(parseOfx(EXTRATO_SGML));
  assert.deepEqual(primeira, segunda);
});

test("cada movimento do extrato tem um fingerprint só seu", () => {
  const fingerprints = calcularFingerprints(extrato);
  assert.equal(fingerprints.length, extrato.movimentos.length);
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});

test("mesmo FITID com valores diferentes gera fingerprints diferentes", () => {
  // As duas linhas de 03/08 compartilham o FITID 202608030001. Se o
  // fingerprint dependesse dele, a segunda seria descartada na importação.
  const fingerprints = calcularFingerprints(extrato);
  assert.equal(extrato.movimentos[1].fitid, extrato.movimentos[2].fitid);
  assert.notEqual(fingerprints[1], fingerprints[2]);
});

test("duas linhas idênticas continuam sendo dois movimentos", () => {
  // As duas tarifas de R$ 2,90 do dia 05/08 são indistinguíveis pelo que o
  // banco informou — é a ocorrência dentro do arquivo que as separa.
  const fingerprints = calcularFingerprints(extrato);
  assert.equal(
    chaveBaseDoMovimento(extrato.cabecalho, extrato.movimentos[4]),
    chaveBaseDoMovimento(extrato.cabecalho, extrato.movimentos[5]),
  );
  assert.notEqual(fingerprints[4], fingerprints[5]);
});

test("mudar valor, data, sinal ou memo muda o fingerprint", () => {
  const base = extrato.movimentos[0];
  const chave = (alteracao: Partial<typeof base>) =>
    chaveBaseDoMovimento(extrato.cabecalho, { ...base, ...alteracao });

  assert.notEqual(chave({}), chave({ valorCentavos: 97_001 }));
  assert.notEqual(chave({}), chave({ valorCentavos: -97_000 }));
  assert.notEqual(chave({}), chave({ dataPostagem: "2026-08-02" }));
  assert.notEqual(chave({}), chave({ memo: "OUTRA COISA" }));
  assert.notEqual(chave({}), chave({ refnum: "999" }));
});

test("mudar só o FITID não muda a identidade da linha", () => {
  const base = extrato.movimentos[0];
  assert.equal(
    chaveBaseDoMovimento(extrato.cabecalho, base),
    chaveBaseDoMovimento(extrato.cabecalho, { ...base, fitid: "999" }),
  );
});

test("duas exportações do C6 reconhecem os movimentos em comum", () => {
  // O C6 regenera o FITID a cada exportação. Os quatro movimentos de 01/09 a
  // 15/09 estão nos dois arquivos e precisam ter o mesmo fingerprint — senão a
  // linha já conciliada volta como pendente e convida a lançar o dinheiro de
  // novo.
  const antigo = parseOfx(EXTRATO_C6_15_09);
  const novo = parseOfx(EXTRATO_C6_22_09);
  assert.notEqual(antigo.movimentos[1].fitid, novo.movimentos[0].fitid);

  const doAntigo = new Set(calcularFingerprints(antigo));
  const emComum = calcularFingerprints(novo).filter((fingerprint) => doAntigo.has(fingerprint));
  assert.equal(emComum.length, 4);
});

test("acento e espaçamento no memo não mudam a identidade da linha", () => {
  // O mesmo extrato relido em outra codificação não pode virar movimento novo.
  const base = extrato.movimentos[0];
  assert.equal(
    chaveBaseDoMovimento(extrato.cabecalho, { ...base, memo: "CRED PIX RECEBIDO MARIA SOUZA" }),
    chaveBaseDoMovimento(extrato.cabecalho, { ...base, memo: "Créd  Pix / recebido - María Souza" }),
  );
});

test("a mesma linha em contas diferentes não colide", () => {
  const outraConta = { ...extrato.cabecalho, acctId: "999999-9" };
  assert.notEqual(
    chaveBaseDoMovimento(extrato.cabecalho, extrato.movimentos[0]),
    chaveBaseDoMovimento(outraConta, extrato.movimentos[0]),
  );
});

test("reimportar um arquivo com período maior preserva os fingerprints antigos", () => {
  // O arquivo de setembro traz agosto inteiro mais uma linha nova. As linhas
  // de agosto precisam sair com a mesma chave, ou a importação as duplicaria.
  const ampliado = EXTRATO_SGML.replace(
    "</BANKTRANLIST>",
    `<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260901120000[-3:BRT]
<TRNAMT>-77.00
<FITID>202609010001
<MEMO>NOVA DESPESA
</STMTTRN>
</BANKTRANLIST>`,
  );

  const originais = calcularFingerprints(extrato);
  const novos = calcularFingerprints(parseOfx(ampliado));

  assert.equal(novos.length, originais.length + 1);
  assert.deepEqual(novos.slice(0, originais.length), originais);
});

test("o hash do arquivo muda com qualquer byte diferente", () => {
  const a = hashDoArquivo(Buffer.from(EXTRATO_SGML, "utf8"));
  const b = hashDoArquivo(Buffer.from(EXTRATO_SGML, "utf8"));
  const c = hashDoArquivo(Buffer.from(`${EXTRATO_SGML} `, "utf8"));

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});
