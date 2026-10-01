import assert from "node:assert/strict";
import test from "node:test";

import {
  diaLocal,
  linhaDoRecebimento,
  reparteRecebimento,
  saldosDoDocumento,
  type RecebimentoDoDocumento,
} from "./recebimentos-de-documentos";

const HOJE = "2026-10-01";

function recebimento(valores: Partial<RecebimentoDoDocumento>): RecebimentoDoDocumento {
  return { id: 1, data: "2026-09-10", metodopagamento: "PIX", tipo: "RECEITA", valor: 100, pendente: false, ...valores };
}

test("dia local lê data pura e instante no fuso da operação", () => {
  assert.equal(diaLocal("2026-09-30"), "2026-09-30");
  // 01:00 UTC do dia 1º ainda é dia 30 em Fortaleza.
  assert.equal(diaLocal("2026-10-01T01:00:00Z"), "2026-09-30");
  assert.equal(diaLocal(null), "");
});

test("pendente se separa em vencido e a vencer pelo vencimento", () => {
  const vencido = reparteRecebimento(recebimento({ pendente: true, vencimento_em: "2026-09-30" }), HOJE);
  assert.equal(vencido.pendenteVencido, 100);
  assert.equal(vencido.pendenteAVencer, 0);

  // Vence hoje: ainda não venceu.
  const hoje = reparteRecebimento(recebimento({ pendente: true, vencimento_em: "2026-10-01" }), HOJE);
  assert.equal(hoje.pendenteVencido, 0);
  assert.equal(hoje.pendenteAVencer, 100);

  // Sem `vencimento_em`, vale a data do título.
  const semVencimento = reparteRecebimento(recebimento({ pendente: true, data: "2026-09-01" }), HOJE);
  assert.equal(semVencimento.pendenteVencido, 100);
});

test("baixado não tem pendência, por mais antigo que seja", () => {
  const parte = reparteRecebimento(recebimento({ pendente: false, data: "2025-01-01" }), HOJE);
  assert.deepEqual(
    { recebido: parte.recebido, vencido: parte.pendenteVencido, aVencer: parte.pendenteAVencer },
    { recebido: 100, vencido: 0, aVencer: 0 },
  );
});

test("saldos do documento fecham com o valor devido", () => {
  const saldos = saldosDoDocumento({
    totalComercial: 1_000,
    recebimentos: [
      recebimento({ valor: 300 }),
      recebimento({ valor: 200, pendente: true, vencimento_em: "2026-09-15", valor_baixado: 50 }),
      recebimento({ valor: 100, pendente: true, vencimento_em: "2026-11-15" }),
    ],
    semValorDevido: false,
    hoje: HOJE,
  });
  // Recebido, vencido, a vencer, sem lançamento.
  assert.deepEqual(saldos, [350, 150, 100, 400]);
  assert.equal(saldos.reduce((soma, valor) => soma + valor, 0), 1_000);
});

test("documento sem valor devido não tem saldo sem lançamento", () => {
  const saldos = saldosDoDocumento({ totalComercial: 1_000, recebimentos: [], semValorDevido: true, hoje: HOJE });
  assert.deepEqual(saldos, [0, 0, 0, 0]);
});

test("linha do recebimento diz a situação e o vencimento", () => {
  const linha = linhaDoRecebimento(
    recebimento({ id: 7, metodopagamento: "BOLETO", valor: 200, pendente: true, vencimento_em: "2026-09-15", valor_baixado: 50 }),
    HOJE,
  );
  assert.deepEqual(linha, [7, "15/09/2026", "BOLETO", "Parcial · vencido", 200, 50, 150, 0]);
});
