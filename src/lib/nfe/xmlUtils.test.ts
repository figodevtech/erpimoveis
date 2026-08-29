import assert from "node:assert/strict";
import test from "node:test";

import {
  escapeXml,
  NFE_XNOME_MAX_LENGTH,
  truncateNfeXNome,
  truncateNfeXNomeInXml,
} from "./xmlUtils";

test("trunca xNome depois de sanitizar e antes de escapar o XML", () => {
  const original = `  ÁRVORE   &   ${"X".repeat(80)}  `;
  const fiscal = truncateNfeXNome(original);

  assert.equal(fiscal.length, NFE_XNOME_MAX_LENGTH);
  assert.match(fiscal, /^ARVORE & X+/);
  assert.match(escapeXml(fiscal), /^ARVORE &amp; X+/);
  assert.equal(original.length > NFE_XNOME_MAX_LENGTH, true);
});

test("preserva xNome que já cabe no leiaute", () => {
  assert.equal(truncateNfeXNome("CLIENTE TESTE LTDA"), "CLIENTE TESTE LTDA");
});

test("corrige todos os xNome de um rascunho legado sem contar entidades XML", () => {
  const xml =
    `<NFe><emit><xNome>${"E".repeat(61)}</xNome></emit>` +
    `<dest><xNome>${"D".repeat(59)}&amp;B</xNome></dest></NFe>`;

  const corrigido = truncateNfeXNomeInXml(xml);
  const nomes = Array.from(corrigido.matchAll(/<xNome>(.*?)<\/xNome>/g), (match) => match[1]);

  assert.equal(nomes[0], "E".repeat(60));
  assert.equal(nomes[1], `${"D".repeat(59)}&amp;`);
});
