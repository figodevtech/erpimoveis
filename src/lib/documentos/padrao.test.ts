import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { CATALOGOS, TRECHOS_DA_FOLHA } from "./catalogo";
import { variaveisDesconhecidas } from "./motor";
import { DOCUMENTOS_PADRAO, MODELO_EM_BRANCO } from "./padrao";
import { MODULOS_DOCUMENTO } from "./tipos";

const semCR = (texto: string) => texto.replace(/\r\n/g, "\n");

/**
 * A migration semeia os mesmos três modelos, em SQL. São duas cópias do mesmo
 * texto — o banco não lê TypeScript —, então aqui elas são confrontadas:
 * mexer em uma sem mexer na outra quebra o teste.
 */
test("o seed da migration carrega exatamente os modelos padrão", () => {
  const migration = semCR(
    readFileSync(path.join(process.cwd(), "supabase/migrations/20261014150000_documento_modelo.sql"), "utf8"),
  );

  for (const doc of DOCUMENTOS_PADRAO) {
    assert.ok(
      migration.includes(`('${doc.codigo}', '${doc.modulo}', '${doc.nome}', `),
      `a migration não semeia ${doc.codigo} no módulo ${doc.modulo}`,
    );
    assert.ok(migration.includes(`$doc$${semCR(doc.html)}$doc$`), `o HTML de ${doc.codigo} diverge da migration`);
  }

  // E o seed não pode atropelar quem já personalizou ou excluiu.
  assert.ok(migration.includes("ON CONFLICT (codigo_padrao) DO NOTHING"));
});

test("um padrão por módulo, com código único", () => {
  assert.deepEqual(DOCUMENTOS_PADRAO.map((d) => d.modulo).sort(), [...MODULOS_DOCUMENTO].sort());
  assert.equal(new Set(DOCUMENTOS_PADRAO.map((d) => d.codigo)).size, DOCUMENTOS_PADRAO.length);
});

test("os padrões só usam variáveis do catálogo do seu módulo", () => {
  for (const doc of DOCUMENTOS_PADRAO) {
    assert.deepEqual(variaveisDesconhecidas(doc.html, CATALOGOS[doc.modulo]), [], doc.codigo);
  }
  for (const modulo of MODULOS_DOCUMENTO) {
    assert.deepEqual(variaveisDesconhecidas(MODELO_EM_BRANCO, CATALOGOS[modulo]), [], `em branco: ${modulo}`);
  }
});

test("os trechos de estrutura da folha só usam variáveis do catálogo", () => {
  for (const modulo of MODULOS_DOCUMENTO) {
    for (const t of TRECHOS_DA_FOLHA) {
      assert.deepEqual(variaveisDesconhecidas(t.trecho, CATALOGOS[modulo]), [], `${t.rotulo} em ${modulo}`);
    }
  }
});
