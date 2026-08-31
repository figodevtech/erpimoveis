import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DescricaoServico } from "./descricao-servico";

test("renderiza titulo, subdescricao e observacao de execucao separadamente", () => {
  const html = renderToStaticMarkup(
    <DescricaoServico
      descricao="Troca de óleo"
      subdescricao="Inclui limpeza do cárter"
      observacao="Filtro conferido"
      identificador="SRV-10"
    />,
  );

  assert.match(html, /Troca de óleo/);
  assert.match(html, /Inclui limpeza do cárter/);
  assert.match(html, /Execução: Filtro conferido/);
  assert.match(html, /SRV-10/);
});

test("nao cria linhas complementares quando os detalhes estao ausentes", () => {
  const html = renderToStaticMarkup(<DescricaoServico descricao="Alinhamento" />);

  assert.match(html, />Alinhamento</);
  assert.doesNotMatch(html, /text-xs/);
  assert.doesNotMatch(html, /Execução:/);
});
