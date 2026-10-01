import assert from "node:assert/strict";
import test from "node:test";

import { lerResumoFinanceiro, resumirRecebimentosPorMetodo } from "./resumo-financeiro-model";

test("resumo por método soma recebido, vencido e a vencer de cada forma de pagamento", () => {
  const resumo = resumirRecebimentosPorMetodo([
    { documento: "1", metodo: "PIX", recebido: 100, pendenteVencido: 0, pendenteAVencer: 0 },
    { documento: "2", metodo: "BOLETO", recebido: 0, pendenteVencido: 150, pendenteAVencer: 0 },
    { documento: "2", metodo: "BOLETO", recebido: 0, pendenteVencido: 0, pendenteAVencer: 150 },
    // Baixa parcial: um lançamento só, nas duas colunas.
    { documento: "3", metodo: "boleto", recebido: 40.1, pendenteVencido: 0, pendenteAVencer: 59.9 },
    { documento: "4", metodo: "", recebido: 10, pendenteVencido: 0, pendenteAVencer: 0 },
  ]);

  assert.deepEqual(resumo, [
    { metodo: "BOLETO", lancamentos: 3, recebido: 40.1, pendenteVencido: 150, pendenteAVencer: 209.9, total: 400 },
    { metodo: "PIX", lancamentos: 1, recebido: 100, pendenteVencido: 0, pendenteAVencer: 0, total: 100 },
    { metodo: "", lancamentos: 1, recebido: 10, pendenteVencido: 0, pendenteAVencer: 0, total: 10 },
  ]);
});

test("resumo por método vazio sem recebimento nenhum", () => {
  assert.deepEqual(resumirRecebimentosPorMetodo([]), []);
});

/** Um leitor de aba como o das folhas: a primeira linha é o cabeçalho. */
type Celula = string | number | boolean | null;

function aba(matriz: Celula[][]) {
  const [cabecalho, ...rows] = matriz;
  return { rows, read: (row: Celula[], label: string) => row[cabecalho.indexOf(label)] ?? null };
}

test("lê saldos da aba principal e recebimentos pela coluna do documento", () => {
  const principal = aba([
    ["Venda", "Recebido (R$)", "Pendente vencido (R$)", "Pendente a vencer (R$)", "Sem lançamento (R$)"],
    [10, 100, 0, 50, 0],
    [11, 0, 30, 0, 20],
  ]);
  const recebimentos = aba([
    ["Venda", "Método", "Recebido (R$)", "Pendente vencido (R$)", "Pendente a vencer (R$)"],
    [10, "PIX", 100, 0, 0],
    [10, "BOLETO", 0, 0, 50],
  ]);

  const resumo = lerResumoFinanceiro(principal, recebimentos, "Venda");
  assert.deepEqual(resumo.saldos, { recebido: 100, pendenteVencido: 30, pendenteAVencer: 50, semLancamento: 20 });
  assert.deepEqual(resumo.recebimentos.map((linha) => [linha.documento, linha.metodo]), [["10", "PIX"], ["10", "BOLETO"]]);
});

test("planilha sem as colunas do resumo devolve tudo zerado", () => {
  const resumo = lerResumoFinanceiro(aba([["OS"], [1]]), null, "OS");
  assert.deepEqual(resumo.saldos, { recebido: 0, pendenteVencido: 0, pendenteAVencer: 0, semLancamento: 0 });
  assert.deepEqual(resumo.recebimentos, []);
});
