import assert from "node:assert/strict";
import test from "node:test";

import { tituloServicoDaOs } from "./titulo-servico";

test("junta o nome do cadastro com o texto livre da linha", () => {
  assert.equal(
    tituloServicoDaOs("REPARO", "RECUPERAÇÃO DO CILINDRO DA CABINE", 37),
    "REPARO - RECUPERAÇÃO DO CILINDRO DA CABINE",
  );
});

test("sem texto livre, fica só o nome do cadastro", () => {
  assert.equal(tituloServicoDaOs("TESTE COMPUTADORIZADO", null, 12), "TESTE COMPUTADORIZADO");
  assert.equal(tituloServicoDaOs("TESTE COMPUTADORIZADO", "   ", 12), "TESTE COMPUTADORIZADO");
});

test("texto livre repetindo o cadastro não vira 'REPARO - REPARO'", () => {
  assert.equal(tituloServicoDaOs("REPARO", "reparo", 37), "reparo");
  assert.equal(tituloServicoDaOs("REPARO", " Reparo ", 37), "Reparo");
});

test("texto livre que já começa pelo cadastro vale sozinho", () => {
  assert.equal(
    tituloServicoDaOs("MAO DE OBRA + SERVIÇO", "MAO DE OBRA + SERVIÇO, REVISAO NA BOMBA", 11),
    "MAO DE OBRA + SERVIÇO, REVISAO NA BOMBA",
  );
  assert.equal(tituloServicoDaOs("REPARO", "reparo do injetor", 37), "reparo do injetor");
});

test("cadastro que só aparece no meio do texto livre ainda prefixa", () => {
  assert.equal(
    tituloServicoDaOs("REPARO", "SEGUNDO REPARO DA BOMBA", 37),
    "REPARO - SEGUNDO REPARO DA BOMBA",
  );
});

test("quebra de linha no texto livre não quebra o título", () => {
  assert.equal(
    tituloServicoDaOs("REPARO", "linha 1\n  linha 2", 37),
    "REPARO - linha 1 linha 2",
  );
});

test("serviço sem cadastro usa o texto livre", () => {
  assert.equal(tituloServicoDaOs(null, "TROCA DE ÓLEO", 37), "TROCA DE ÓLEO");
});

test("sem nenhum dos dois, a linha ainda se identifica", () => {
  assert.equal(tituloServicoDaOs(null, null, 37), "Serviço #37");
  assert.equal(tituloServicoDaOs(undefined, undefined, null), "Serviço");
});
