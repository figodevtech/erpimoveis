import assert from "node:assert/strict";
import test from "node:test";

import {
  mensagemRealizadoresPendentes,
  podeEditarRealizadores,
  podeFicarSemRealizador,
  servicosSemRealizador,
} from "./realizadores";

const servicos = [
  { servicoid: 1, descricao: "Troca de óleo" },
  { servicoid: 2, descricao: "Alinhamento" },
  { servicoid: 3, descricao: null },
];

test("sem escopo, cobra realizador de todos os serviços", () => {
  const pendentes = servicosSemRealizador(servicos, [{ servicoid: 1 }]);

  assert.deepEqual(pendentes, [
    { servicoid: 2, descricao: "Alinhamento" },
    { servicoid: 3, descricao: "Serviço #3" },
  ]);
});

test("com escopo, ignora serviço fora dele mesmo sem realizador", () => {
  const pendentes = servicosSemRealizador(servicos, [{ servicoid: 1 }], [2]);

  assert.deepEqual(pendentes, [{ servicoid: 2, descricao: "Alinhamento" }]);
});

test("escopo vazio não cobra nada", () => {
  assert.deepEqual(servicosSemRealizador(servicos, [], []), []);
});

test("serviço com mais de um realizador conta como atendido uma vez só", () => {
  const pendentes = servicosSemRealizador(
    [{ servicoid: 1, descricao: "Troca de óleo" }],
    [{ servicoid: 1 }, { servicoid: 1 }],
  );

  assert.deepEqual(pendentes, []);
});

test("vínculo órfão de serviço removido não libera outro serviço", () => {
  const pendentes = servicosSemRealizador(
    [{ servicoid: 2, descricao: "Alinhamento" }],
    [{ servicoid: 9 }],
  );

  assert.deepEqual(pendentes, [{ servicoid: 2, descricao: "Alinhamento" }]);
});

test("OS sem serviços não tem pendência", () => {
  assert.deepEqual(servicosSemRealizador([], []), []);
});

test("a mensagem nomeia os serviços e muda conforme a ação", () => {
  const pendentes = [{ servicoid: 2, descricao: "Alinhamento" }];

  assert.match(mensagemRealizadoresPendentes(pendentes, "iniciar"), /iniciar a OS.*Alinhamento/);
  assert.match(mensagemRealizadoresPendentes(pendentes, "pagamento"), /para pagamento.*Alinhamento/);
  assert.match(mensagemRealizadoresPendentes(pendentes, "orcamento"), /orçamento: Alinhamento/);
});

test("realizador é editável da aprovação até o pagamento", () => {
  for (const status of ["ORCAMENTO_APROVADO", "EM_ANDAMENTO", "PAGAMENTO"]) {
    assert.equal(podeEditarRealizadores(status), true, status);
  }
  for (const status of ["ORCAMENTO", "APROVACAO_ORCAMENTO", "CONCLUIDO", "SEM_COBRANCA", "CANCELADO", "", null]) {
    assert.equal(podeEditarRealizadores(status), false, String(status));
  }
});

test("depois de iniciada, a lista não pode terminar vazia", () => {
  assert.equal(podeFicarSemRealizador("EM_ANDAMENTO"), false);
  assert.equal(podeFicarSemRealizador("PAGAMENTO"), false);
  assert.equal(podeFicarSemRealizador("ORCAMENTO_APROVADO"), true);
});
