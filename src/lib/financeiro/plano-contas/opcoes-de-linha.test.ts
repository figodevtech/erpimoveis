import assert from "node:assert/strict";
import test from "node:test";

import { ordenarPorLinha, rotuloDaLinha, type OpcaoDeLinha } from "./opcoes-de-linha";

const linha = (nome: string, codigo: string): OpcaoDeLinha => ({
  nome,
  destino: { fora_da_dre: false, linha_codigo: codigo, linha_nome: null },
});
const fora = (nome: string): OpcaoDeLinha => ({
  nome,
  destino: { fora_da_dre: true, linha_codigo: null, linha_nome: null },
});

test("as linhas saem na ordem do relatório, com código numérico e não alfabético", () => {
  const ordem = ordenarPorLinha([
    linha("Despesas financeiras", "10.2"),
    linha("IRPJ", "13.1"),
    linha("Ocupação e estrutura", "6.4"),
    linha("Receita de serviços", "1.2"),
    linha("Outras despesas operacionais", "6.6"),
  ]).map((item) => item.destino?.linha_codigo);

  assert.deepEqual(ordem, ["1.2", "6.4", "6.6", "10.2", "13.1"]);
});

test("o que fica fora da DRE vem depois das linhas, e o sem destino no fim", () => {
  const ordem = ordenarPorLinha([
    { nome: "Sem destino", destino: null },
    fora("Transferências internas"),
    linha("Depreciação", "8"),
  ]).map((item) => item.nome);

  assert.deepEqual(ordem, ["Depreciação", "Transferências internas", "Sem destino"]);
});

test("duas classificações na mesma linha desempatam pelo nome", () => {
  const ordem = ordenarPorLinha([
    linha("Outras receitas da atividade", "1.3"),
    linha("Frete cobrado do cliente", "1.3"),
  ]).map((item) => item.nome);

  assert.deepEqual(ordem, ["Frete cobrado do cliente", "Outras receitas da atividade"]);
});

test("o rótulo mostra a linha e o nome da classificação", () => {
  assert.equal(rotuloDaLinha(linha("IRPJ", "13.1")), "13.1 · IRPJ");
  assert.equal(rotuloDaLinha(fora("Sócios e patrimônio")), "Fora da DRE · Sócios e patrimônio");
  assert.equal(rotuloDaLinha({ nome: "Algo", destino: null }), "Algo · sem linha no relatório");
});
