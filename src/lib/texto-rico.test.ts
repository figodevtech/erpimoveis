import assert from "node:assert/strict";
import test from "node:test";

import { paraHtmlDoEditor, pareceHtml, textoParaHtml, textoPlanoDoHtml } from "./texto-rico";

test("texto puro antigo vira um parágrafo por linha, com escape", () => {
  assert.equal(textoParaHtml("Caução R$ 200\n\nEntregar <amanhã> & cedo"), "<p>Caução R$ 200</p><p></p><p>Entregar &lt;amanhã&gt; &amp; cedo</p>");
  assert.equal(textoParaHtml("   "), "");
  assert.equal(textoParaHtml(null), "");
  assert.equal(paraHtmlDoEditor("linha 1\r\nlinha 2"), "<p>linha 1</p><p>linha 2</p>");
});

test("HTML do editor é reconhecido e passa intacto ao editor", () => {
  const html = "<p><strong>Caução</strong></p><ul><li><p>Capacete</p></li></ul>";
  assert.equal(pareceHtml(html), true);
  assert.equal(paraHtmlDoEditor(html), html);
  assert.equal(pareceHtml("a < b e c > d"), false);
  assert.equal(pareceHtml("Use 2x <parafuso>"), false);
});

test("texto plano do HTML preserva as quebras e desfaz entidades", () => {
  assert.equal(textoPlanoDoHtml("<p>Um &amp; dois</p><ul><li><p>Três</p></li></ul>"), "Um & dois\nTrês");
  assert.equal(textoPlanoDoHtml("<p></p>"), "");
});
