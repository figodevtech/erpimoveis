import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeAccountant, planAccountantPeriod } from "./accountant";

const valido = {
  nome: "  Maria   da Silva ",
  cpf: "529.982.247-25",
  crc: "PB-012345/O-1",
  cnpjEscritorio: "00.000.000/E08G-12",
  cep: "58.000-000",
  endereco: "Av. Epitácio Pessoa",
  numero: "100",
  complemento: "",
  bairro: "Tambaú",
  telefone: "(83) 99999-0000",
  fax: "",
  email: "Contato@Escritorio.com.br",
  codigoMunicipio: "2507507",
};

describe("dados do contabilista para o registro 0100", () => {
  it("normaliza documento, contatos e espaços", () => {
    const resultado = normalizeAccountant(valido);
    assert.ok("value" in resultado);
    assert.equal(resultado.value.nome, "Maria da Silva");
    assert.equal(resultado.value.cpf, "52998224725");
    assert.equal(resultado.value.cnpj_escritorio, "00000000E08G12");
    assert.equal(resultado.value.cep, "58000000");
    assert.equal(resultado.value.telefone, "83999990000");
    assert.equal(resultado.value.email, "contato@escritorio.com.br");
    assert.equal(resultado.value.complemento, null);
    assert.equal(resultado.value.fax, null);
  });

  it("escritório é opcional", () => {
    const resultado = normalizeAccountant({ ...valido, cnpjEscritorio: "" });
    assert.ok("value" in resultado);
    assert.equal(resultado.value.cnpj_escritorio, null);
  });

  it("aponta todos os campos obrigatórios que faltam", () => {
    const resultado = normalizeAccountant({});
    assert.ok("errors" in resultado);
    for (const trecho of ["nome", "CRC", "endereço", "número", "bairro", "CPF", "CEP", "e-mail", "município"]) {
      assert.ok(resultado.errors.some((erro) => erro.includes(trecho)), `faltou erro de ${trecho}`);
    }
  });

  it("recusa CPF com dígito errado, CNPJ inválido e pipe", () => {
    const resultado = normalizeAccountant({ ...valido, cpf: "529.982.247-26", cnpjEscritorio: "00000000E08G13", nome: "Maria | Silva" });
    assert.ok("errors" in resultado);
    assert.equal(resultado.errors.length, 3);
  });
});

describe("vigência do contabilista", () => {
  const atual = { id: 1, vigencia_inicio: "2026-01-01", vigencia_fim: null };

  it("primeiro cadastro fica aberto", () => {
    assert.deepEqual(planAccountantPeriod([], "2026-08-01"), { end: null, closePrevious: null });
  });

  it("troca de contador encerra o anterior na véspera", () => {
    assert.deepEqual(planAccountantPeriod([atual], "2026-09-01"), {
      end: null,
      closePrevious: { id: 1, end: "2026-08-31" },
    });
  });

  it("cadastro anterior ao primeiro cobre só até a véspera dele", () => {
    assert.deepEqual(planAccountantPeriod([atual], "2025-07-01"), {
      end: "2025-12-31",
      closePrevious: null,
    });
  });

  it("entre dois contadores, encaixa sem sobrepor", () => {
    const periodos = [
      { id: 1, vigencia_inicio: "2026-01-01", vigencia_fim: "2026-12-31" },
      { id: 2, vigencia_inicio: "2027-01-01", vigencia_fim: null },
    ];
    assert.deepEqual(planAccountantPeriod(periodos, "2026-06-01"), {
      end: "2026-12-31",
      closePrevious: { id: 1, end: "2026-05-31" },
    });
  });

  it("mesmo mês de início é correção, não troca", () => {
    const plano = planAccountantPeriod([atual], "2026-01-01");
    assert.ok("error" in plano);
  });
});
