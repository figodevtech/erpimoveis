import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse1601Csv } from "./import-1601";
import { parsePreviousEfd, previousCompetence } from "./import-previous";

describe("importação da EFD anterior", () => {
  it("exige exatamente a competência anterior e extrai o saldo do E110", () => {
    const file = [
      "|0000|020|0|01072026|31072026|DEMIR|04252011000110|PB|123|2507507|||B|1|",
      "|E110|100,00|0,00|0,00|0,00|40,00|0,00|0,00|0,00|12,34|60,00|0,00|47,66|0,00|0,00|",
      "|9990|2|",
      "|9999|4|",
    ].join("\r\n");
    const parsed = parsePreviousEfd(file, "2026-08", "04.252.011/0001-10");
    assert.equal(parsed.header.startDate, "2026-07-01");
    assert.equal(parsed.balances.icmsProprio.saldoCredorAnterior, 12.34);
    assert.equal(parsed.balances.icmsProprio.icmsRecolher, 47.66);
  });

  it("preserva CNPJ alfanumérico do registro 0000", () => {
    const file = [
      "|0000|020|0|01072026|31072026|EMPRESA|00000000E08G12|PB|123|2507507|||B|1|",
      "|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|",
      "|9990|2|",
      "|9999|4|",
    ].join("\r\n");
    assert.equal(parsePreviousEfd(file, "2026-08").header.cnpj, "00000000E08G12");
  });

  it("calcula corretamente a virada de ano", () => {
    assert.equal(previousCompetence("2026-01"), "2025-12");
  });
});

describe("importação CSV do registro 1601", () => {
  it("aceita ponto e vírgula, decimal brasileiro e CNPJ alfanumérico", () => {
    const rows = parse1601Csv([
      "instituicao_cnpj;instituicao_nome;intermediario_cnpj;intermediario_nome;total_operacoes;total_iss;total_outros",
      "00.000.000/E08G-12;Instituição Teste;;;1.234,56;0,00;10,25",
    ].join("\r\n"));
    assert.equal(rows[0].institutionCnpj, "00000000E08G12");
    assert.equal(rows[0].institutionParticipantCode, "IP00000000E08G12");
    assert.equal(rows[0].totalOperations, 1234.56);
    assert.equal(rows[0].totalOthers, 10.25);
  });

  it("rejeita CNPJ inválido e pares duplicados", () => {
    assert.throws(() => parse1601Csv([
      "instituicao_cnpj,instituicao_nome,intermediario_cnpj,intermediario_nome,total_operacoes,total_iss,total_outros",
      "00000000E08G13,Inválida,,,10.00,0.00,0.00",
    ].join("\n")), /CNPJ da instituição inválido/);

    assert.throws(() => parse1601Csv([
      "instituicao_cnpj,instituicao_nome,intermediario_cnpj,intermediario_nome,total_operacoes,total_iss,total_outros",
      "04252011000110,A,,,10.00,0.00,0.00",
      "04252011000110,A,,,20.00,0.00,0.00",
    ].join("\n")), /duplicados/);
  });
});
