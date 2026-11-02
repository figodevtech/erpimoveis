import assert from "node:assert/strict";
import test from "node:test";
import { imovelSchema } from "./schemas";
import { duplicateMessage, validationDetails, validationSummary } from "./validation-messages";

const base = {
  ativo: true, publicado: false, modalidades: ["TEMPORADA"], tipo: "FLAT", capacidade: 1,
  endereco: {}, endereco_publico: {}, caracteristicas: {}, slug: "flat-teste",
};

function details(payload: unknown) {
  const result = imovelSchema.safeParse(payload);
  assert.equal(result.success, false);
  return validationDetails(result.error!);
}

test("imóvel sem proprietário diz qual campo falta, em português", () => {
  assert.deepEqual(details({ ...base, titulo: "Flat teste" }), ["Proprietário: selecione um cadastro"]);
  assert.deepEqual(details({ ...base, titulo: "Flat teste", proprietario_id: "" }), ["Proprietário: selecione um cadastro"]);
});

test("cada campo aparece uma vez, com o nome do formulário", () => {
  const lines = details({
    ...base, proprietario_id: 1, titulo: "", slug: "", modalidades: [], max_noites: "",
    horario_checkin: "1400", comodidades: ["x".repeat(130)],
  });
  assert.ok(lines.includes("Título do anúncio: deve ter pelo menos 2 caracteres"));
  assert.ok(lines.includes("Modalidades: selecione pelo menos uma opção"));
  assert.ok(lines.includes("Comodidades (item 1): pode ter no máximo 120 caracteres"));
  assert.ok(lines.includes("Máximo de noites: deve ser no mínimo 1"));
  assert.ok(lines.includes("Horário de check-in: use o formato HH:MM (ex.: 14:00)"));
  assert.equal(lines.filter((line) => line.startsWith("Endereço do anúncio")).length, 1);
});

test("resumo e duplicidade", () => {
  assert.equal(validationSummary(["Proprietário: selecione um cadastro"]), "Confira o campo Proprietário: selecione um cadastro.");
  assert.match(validationSummary(["a", "b", "c"]), /^Corrija 3 campos: a; e mais 2\.$/);
  assert.match(duplicateMessage({ message: 'duplicate key value violates unique constraint "imovel_slug_key"' }), /slug/);
  assert.equal(duplicateMessage({ message: "duplicate key" }), "Já existe um registro com esses dados.");
});
