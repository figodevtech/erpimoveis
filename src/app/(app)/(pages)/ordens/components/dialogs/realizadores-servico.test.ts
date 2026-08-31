import assert from "node:assert/strict";
import test from "node:test";
import {
  descreverRealizadores,
  normalizarIdsRealizadores,
  normalizarRealizadores,
} from "./realizadores-servico";

test("normaliza um realizador do vinculo N:N", () => {
  assert.deepEqual(
    normalizarRealizadores({ realizadores: [{ id: "user-1", nome: "Maria" }] }),
    [{ id: "user-1", nome: "Maria" }],
  );
});

test("preserva multiplos realizadores e remove IDs duplicados", () => {
  assert.deepEqual(
    normalizarRealizadores({
      realizadores: [
        { id: "user-1", nome: null },
        { id: "user-1", nome: "Maria" },
        { id: "user-2", nome: "João" },
      ],
    }),
    [
      { id: "user-1", nome: "Maria" },
      { id: "user-2", nome: "João" },
    ],
  );
});

test("usa o vinculo singular legado quando a lista N:N esta vazia", () => {
  assert.deepEqual(
    normalizarRealizadores({
      realizadores: [],
      idusuariorealizador: "user-legacy",
      realizador: { id: "user-legacy", nome: "Carlos" },
    }),
    [{ id: "user-legacy", nome: "Carlos" }],
  );
});

test("resolve o nome pela lista ativa quando o vinculo nao possui nome", () => {
  assert.deepEqual(
    descreverRealizadores(
      normalizarRealizadores({ realizadores: [{ id: "user-1", nome: null }] }),
      [{ id: "user-1", nome: "Maria" }],
    ),
    { rotulo: "Realizador", texto: "Maria", nomes: ["Maria"] },
  );
});

test("formata multiplos nomes com rotulo plural", () => {
  assert.deepEqual(
    descreverRealizadores(
      [
        { id: "user-1", nome: "Maria" },
        { id: "user-2", nome: "João" },
      ],
      [],
    ),
    {
      rotulo: "Realizadores",
      texto: "Maria, João",
      nomes: ["Maria", "João"],
    },
  );
});

test("nao expoe o UUID quando o nome nao pode ser resolvido", () => {
  const descricao = descreverRealizadores([{ id: "uuid-secreto", nome: null }], []);

  assert.equal(descricao.texto, "Usuário não identificado");
  assert.doesNotMatch(descricao.texto, /uuid-secreto/);
});

test("descreve servico sem vinculo e normaliza IDs da selecao", () => {
  assert.deepEqual(descreverRealizadores([], []), {
    rotulo: "Realizador",
    texto: "Sem realizador",
    nomes: [],
  });
  assert.deepEqual(
    normalizarIdsRealizadores([" user-1 ", "", "user-1", "user-2"]),
    ["user-1", "user-2"],
  );
});
