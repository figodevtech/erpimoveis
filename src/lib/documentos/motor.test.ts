import assert from "node:assert/strict";
import test from "node:test";

import { renderizarModelo, variaveisDesconhecidas } from "./motor";
import type { CatalogoModulo } from "./tipos";

const CATALOGO: CatalogoModulo = {
  modulo: "venda",
  grupos: [
    {
      rotulo: "Teste",
      variaveis: [
        { chave: "cliente.nome", rotulo: "Nome" },
        { chave: "cliente.complemento", rotulo: "Complemento" },
        { chave: "venda.itens_tabela", rotulo: "Tabela", tipo: "html" },
      ],
    },
  ],
  listas: [
    {
      chave: "itens",
      rotulo: "Itens",
      item: "item",
      campos: [{ chave: "descricao", rotulo: "Descrição" }, { chave: "total", rotulo: "Total" }],
    },
  ],
};

test("troca a variável pelo valor, aceitando espaços dentro das chaves", () => {
  const html = renderizarModelo("<p>Olá, {{ cliente.nome }}!</p>", { cliente: { nome: "Maria" } }, CATALOGO);
  assert.equal(html, "<p>Olá, Maria!</p>");
});

test("escapa o valor de texto: o dado do cliente nunca vira marcação", () => {
  const html = renderizarModelo("{{cliente.nome}}", { cliente: { nome: '<script>alert("x")</script> & Cia' } }, CATALOGO);
  assert.equal(html, "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Cia");
});

test("variável do tipo html entra sem escape", () => {
  const html = renderizarModelo("{{venda.itens_tabela}}", { venda: { itens_tabela: "<table></table>" } }, CATALOGO);
  assert.equal(html, "<table></table>");
});

test("variável conhecida sem valor some; desconhecida fica escrita", () => {
  const html = renderizarModelo("[{{cliente.complemento}}] [{{cliente.nme}}]", { cliente: {} }, CATALOGO);
  assert.equal(html, "[] [{{cliente.nme}}]");
});

test("repete o trecho da lista para cada item e enxerga as variáveis de fora", () => {
  const html = renderizarModelo(
    "{{#itens}}<li>{{item.descricao}} {{item.total}} ({{cliente.nome}})</li>{{/itens}}",
    { cliente: { nome: "Maria" }, itens: [{ descricao: "Óleo", total: "R$ 10,00" }, { descricao: "Filtro", total: "R$ 5,00" }] },
    CATALOGO,
  );
  assert.equal(html, "<li>Óleo R$ 10,00 (Maria)</li><li>Filtro R$ 5,00 (Maria)</li>");
});

test("lista vazia não deixa nada no lugar", () => {
  assert.equal(renderizarModelo("a{{#itens}}<li>{{item.descricao}}</li>{{/itens}}b", { itens: [] }, CATALOGO), "ab");
  assert.equal(renderizarModelo("a{{#itens}}x{{/itens}}b", {}, CATALOGO), "ab");
});

test("o valor que entra não é relido como variável", () => {
  const html = renderizarModelo(
    "{{#itens}}{{item.descricao}}{{/itens}} {{cliente.nome}}",
    { cliente: { nome: "{{venda.itens_tabela}}" }, itens: [{ descricao: "{{cliente.nome}}" }], venda: { itens_tabela: "<b>x</b>" } },
    CATALOGO,
  );
  assert.equal(html, "{{cliente.nome}} {{venda.itens_tabela}}");
});

test("variável de item fora da lista é desconhecida", () => {
  assert.equal(renderizarModelo("{{item.descricao}}", { item: { descricao: "x" } }, CATALOGO), "{{item.descricao}}");
});

test("aponta o que o catálogo não conhece, inclusive lista sem fechamento", () => {
  const achadas = variaveisDesconhecidas(
    "{{cliente.nome}} {{cliente.cpf}} {{#itens}}{{item.descricao}}{{item.preco}}{{/itens}} {{item.total}} {{#parcelas}}x{{/parcelas}} {{#itens}} solto",
    CATALOGO,
  );
  assert.deepEqual(achadas.sort(), ["#parcelas", "cliente.cpf", "item.preco", "item.total", "{{#itens}}"].sort());
});

test("modelo sem nada desconhecido não gera aviso", () => {
  assert.deepEqual(variaveisDesconhecidas("{{cliente.nome}}{{#itens}}{{item.total}}{{/itens}}", CATALOGO), []);
});
