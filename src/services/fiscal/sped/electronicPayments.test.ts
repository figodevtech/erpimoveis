import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  build1601FromReceipts,
  splitForClassification,
  splitForServiceOrder,
  type Sped1601Account,
  type Sped1601Receipt,
} from "./electronicPayments";

const BB = "00000000000191";
const ITAU = "60701190000104";

const accounts = new Map<number, Sped1601Account>([
  [2, { id: 2, title: "BANCO DO BRASIL", cnpj: BB }],
  [7, { id: 7, title: "ITAU", cnpj: ITAU }],
  [11, { id: 11, title: "BARAO DAS PEÇAS SANTANDER", cnpj: null }],
  [1, { id: 1, title: "TESOURARIA", cnpj: null }],
]);

const sale = { vs: 1, iss: 0, outros: 0 };
let nextId = 1;
const receipt = (method: string, accountId: number | null, amount: number, split = sale): Sped1601Receipt =>
  ({ transactionId: nextId++, method, accountId, amount, split });

describe("registro 1601 a partir do financeiro", () => {
  it("uma linha por banco, somando PIX, boleto e cartão lançados nas contas dele", () => {
    const { rows, diagnostics } = build1601FromReceipts({
      receipts: [
        receipt("PIX", 2, 1000),
        receipt("BOLETO", 2, 500),
        receipt("CREDITO", 7, 300),
        receipt("DEBITO", 7, 200),
      ],
      accounts,
    });
    assert.equal(diagnostics.length, 0);
    assert.deepEqual(rows.map((row) => [row.instituicao_cnpj, row.instituicao_codigo_participante, row.total_operacoes]), [
      [BB, `P${BB}`, 1500],
      [ITAU, `P${ITAU}`, 500],
    ]);
  });

  it("OS divide entre ICMS (peças e frete) e ISS (serviços) na proporção da própria OS", () => {
    const split = splitForServiceOrder(300, 700);
    const { rows } = build1601FromReceipts({ receipts: [receipt("PIX", 2, 1000, split)], accounts });
    assert.equal(rows[0].total_operacoes, 300);
    assert.equal(rows[0].total_iss, 700);
    assert.deepEqual(splitForServiceOrder(0, 0), { vs: 0, iss: 1, outros: 0 });
  });

  it("dinheiro, permuta e crédito do cliente não passam por instituição e ficam fora", () => {
    const { rows, diagnostics } = build1601FromReceipts({
      receipts: [receipt("DINHEIRO", 1, 900), receipt("PERMUTA", 1, 500), receipt("CREDITO CLIENTE", 1, 18000)],
      accounts,
    });
    assert.deepEqual(rows, []);
    assert.deepEqual(diagnostics, []);
  });

  it("receita avulsa segue o plano de contas: aluguel em outros, antecipação e rendimento fora", () => {
    assert.deepEqual(splitForClassification("OUTRO_GANHO"), { vs: 0, iss: 0, outros: 1 });
    assert.deepEqual(splitForClassification("RECEITA_SERVICOS"), { vs: 0, iss: 1, outros: 0 });
    for (const code of ["DESPESA_FINANCEIRA", "RECEITA_FINANCEIRA", "ADIANTAMENTO", "TRANSFERENCIA_INTERNA", "PATRIMONIAL_EMPRESTIMO", null]) {
      assert.equal(build1601FromReceipts({ receipts: [receipt("PIX", 2, 70386.22, splitForClassification(code))], accounts }).rows.length, 0, String(code));
    }
  });

  it("conta sem CNPJ e recebimento sem conta viram pendência, sem inventar instituição", () => {
    const { rows, diagnostics } = build1601FromReceipts({
      receipts: [receipt("PIX", 11, 11700), receipt("CREDITO", null, 107319), receipt("CREDITO", null, 28100), receipt("PIX", 2, 10)],
      accounts,
    });
    assert.equal(rows.length, 1);
    assert.deepEqual(diagnostics.map((item) => item.code).sort(), ["CONTA_SEM_CNPJ_INSTITUICAO", "RECEBIMENTO_ELETRONICO_SEM_CONTA"]);
    assert.match(diagnostics.find((item) => item.code === "CONTA_SEM_CNPJ_INSTITUICAO")!.message, /BARAO DAS PEÇAS SANTANDER/);
    assert.match(diagnostics.find((item) => item.code === "RECEBIMENTO_ELETRONICO_SEM_CONTA")!.message, /2 recebimento\(s\).*CREDITO/);
  });

  it("nome da instituição vem da lista conhecida; senão, dos títulos das contas", () => {
    const named = build1601FromReceipts({ receipts: [receipt("PIX", 2, 10)], accounts, institutionName: () => "Banco do Brasil" });
    assert.equal(named.rows[0].instituicao_nome, "Banco do Brasil");
    const fallback = build1601FromReceipts({ receipts: [receipt("PIX", 2, 10)], accounts });
    assert.equal(fallback.rows[0].instituicao_nome, "BANCO DO BRASIL");
  });
});
