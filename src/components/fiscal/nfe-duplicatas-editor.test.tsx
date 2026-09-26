import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NfeDuplicatasEditor } from "./nfe-duplicatas-editor";

const duplicatas = [
  { vencimento: "2026-10-25", valor: 0 },
  { vencimento: "2026-11-25", valor: 0 },
];

// O runner tsx compila JSX clássico; o build Next usa o runtime automático.
Object.assign(globalThis, { React });

function botaoDividir(valorEsperado: number, disabled = false, value = duplicatas) {
  const html = renderToStaticMarkup(
    React.createElement(NfeDuplicatasEditor, { value, valorEsperado, disabled, onChange: () => undefined }),
  );
  return { html, botao: html.match(/<button[^>]*>Dividir igualmente<\/button>/)?.[0] ?? "" };
}

test("desabilita a divisão quando alguma parcela ficaria zerada", () => {
  const insuficiente = botaoDividir(0.01);
  assert.match(insuficiente.botao, / disabled=""/);
  assert.match(insuficiente.html, /alguma parcela ficaria zerada/);
  assert.match(botaoDividir(0.01, false, []).botao, / disabled=""/);
  assert.match(botaoDividir(0.02, true).botao, / disabled=""/);
});

test("habilita a divisão quando cada duplicata pode receber ao menos um centavo", () => {
  const suficiente = botaoDividir(0.02);
  assert.doesNotMatch(suficiente.botao, / disabled=""/);
  assert.doesNotMatch(suficiente.html, /alguma parcela ficaria zerada/);
});
