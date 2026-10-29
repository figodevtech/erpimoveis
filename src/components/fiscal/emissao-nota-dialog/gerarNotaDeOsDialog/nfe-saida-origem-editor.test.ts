import assert from "node:assert/strict";
import { it } from "node:test";

import {
  atualizarDecisaoFiscalSaida,
  validarOrigemFiscalSaida,
  type SaidaOrigemDraft,
} from "./nfe-saida-origem-editor";

const comReferencia: SaidaOrigemDraft = {
  operacaoFiscalCodigo: "DEVOLUCAO_COMPRA_COMERCIALIZACAO",
  naturezaOperacao: "DEVOLUCAO DE COMPRA",
  finalidade: "DEVOLUCAO",
  documentoReferenciadoObrigatorio: true,
  chaveAcessoReferenciada: "35260812345678000199550010000001231000001234",
  itens: [{
    sourceItemId: "saida:80:800", saidaId: 80, saidaItemId: 800,
    produtoId: 1964, titulo: "Produto", quantidade: 1,
    entradaItemOrigemId: 300, numeroItemReferenciado: 2,
    percentualDevolucao: 50, valorIpiDevolvido: 10, aviso: "Origem anterior",
  }],
};

it("trocar para operação normal sem referência limpa chave e vínculos antigos", () => {
  const next = atualizarDecisaoFiscalSaida(comReferencia, {
    operacaoFiscalCodigo: "REMESSA_CONSERTO_REPARO",
    naturezaOperacao: "REMESSA PARA CONSERTO OU REPARO",
    finalidade: "NORMAL",
    documentoReferenciadoObrigatorio: false,
  });
  assert.equal(next.chaveAcessoReferenciada, "");
  assert.equal(next.itens[0].entradaItemOrigemId, null);
  assert.equal(next.itens[0].numeroItemReferenciado, null);
  assert.equal(next.itens[0].percentualDevolucao, 100);
  assert.equal(next.itens[0].valorIpiDevolvido, 0);
  assert.equal(next.itens[0].aviso, null);
  assert.deepEqual(validarOrigemFiscalSaida(next), []);
});

it("OUTRA + DEVOLUCAO exige referência mesmo com o switch desligado", () => {
  const next = atualizarDecisaoFiscalSaida(comReferencia, {
    operacaoFiscalCodigo: "OUTRA",
    finalidade: "DEVOLUCAO",
    documentoReferenciadoObrigatorio: false,
  });
  assert.equal(next.itens[0].entradaItemOrigemId, 300);
  assert.notDeepEqual(validarOrigemFiscalSaida({ ...next, chaveAcessoReferenciada: "" }), []);
});
