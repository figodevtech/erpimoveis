import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ItemHistoricoResumo } from "./item-historico-resumo";

test("exibe todos os dados relevantes do snapshot historico", () => {
  const html = renderToStaticMarkup(
    createElement(ItemHistoricoResumo, {
      item: {
        id: 1,
        ordemservicoid: 2,
        linhaOrigem: 3,
        tipo: "SERVICO",
        codigoLegado: "65",
        descricao: "MÃO DE OBRA",
        unidade: "UN",
        quantidade: 2,
        precoUnitario: 50,
        subtotal: 100,
      },
    }),
  );

  assert.match(html, /MÃO DE OBRA/);
  assert.match(html, /Histórico migrado/);
  assert.match(html, /Código legado 65/);
  assert.match(html, /2 UN/);
  assert.match(html, /R\$\s*50,00/);
  assert.match(html, /R\$\s*100,00/);
});
