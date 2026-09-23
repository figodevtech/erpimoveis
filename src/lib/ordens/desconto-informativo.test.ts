import assert from "node:assert/strict";
import test from "node:test";
import { formatarDescontoInformativo, normalizarDescontoInformativo } from "./desconto-informativo";
import { normalizarItens } from "../orcamentos/itens";

test("desconto informativo em reais e percentual não altera o total da proposta", () => {
  for (const tipo of ["FIXO", "PORCENTAGEM"]) {
    const resultado = normalizarItens({
      produtosAvulsos: [{ titulo: "Peça avulsa", quantidade: 2, precounitario: 100,
        descontoInformativoTipo: tipo, descontoInformativo: 10 }],
      descontoTipo: "FIXO", desconto: 20, valorFrete: 5,
    });
    assert.equal(resultado.produtosAvulsos[0].subtotal, 200);
    assert.equal(resultado.produtosAvulsos[0].desconto, 0);
    assert.equal(resultado.produtosAvulsos[0].desconto_informativo_tipo, tipo);
    assert.equal(resultado.produtosAvulsos[0].desconto_informativo, 10);
    assert.equal(resultado.cabecalho.total, 185);
  }
});

test("preserva desconto comercial preexistente e mantém o informativo separado", () => {
  const resultado = normalizarItens({ produtosAvulsos: [{
    titulo: "Peça", quantidade: 2, precounitario: 100,
    descontoTipo: "FIXO", desconto: 30,
    descontoInformativoTipo: "FIXO", descontoInformativo: 50,
  }] });
  assert.equal(resultado.produtosAvulsos[0].desconto, 30);
  assert.equal(resultado.produtosAvulsos[0].desconto_informativo, 50);
  assert.equal(resultado.cabecalho.total, 170);
});

test("itens antigos continuam sem desconto informativo", () => {
  const resultado = normalizarItens({ produtosAvulsos: [{ titulo: "Peça", quantidade: 1, precounitario: 90 }] });
  assert.equal(resultado.produtosAvulsos[0].desconto_informativo_tipo, null);
  assert.equal(resultado.produtosAvulsos[0].desconto_informativo, 0);
  assert.equal(resultado.cabecalho.total, 90);
});

test("limita percentual, arredonda moeda e limpa valores inválidos ou sem tipo", () => {
  assert.equal(normalizarDescontoInformativo("PORCENTAGEM", 150).descontoInformativo, 100);
  assert.equal(normalizarDescontoInformativo("FIXO", 12.345).descontoInformativo, 12.35);
  for (const valor of [-1, NaN, Infinity, "inválido", null]) {
    assert.equal(normalizarDescontoInformativo("FIXO", valor).descontoInformativo, 0);
  }
  assert.deepEqual(normalizarDescontoInformativo(null, 25), {
    descontoInformativoTipo: null, descontoInformativo: 0,
  });
});

test("impressão identifica a anotação e omite desconto vazio", () => {
  assert.match(formatarDescontoInformativo("FIXO", 25)!, /^Desconto informativo: R\$\s25,00 \(não abatido dos totais\)$/);
  assert.equal(formatarDescontoInformativo("PORCENTAGEM", 12.5), "Desconto informativo: 12,5% (não abatido dos totais)");
  assert.equal(formatarDescontoInformativo("FIXO", 0), null);
  assert.equal(formatarDescontoInformativo(null, 20), null);
});
