import assert from "node:assert/strict";
import test from "node:test";

import {
  montarDiscriminacaoServicos,
  type NFSeItemEmissao,
} from "./nfse-service";

/*
 * `Intl.NumberFormat` separa "R$" do valor com espaco nao separavel (U+00A0),
 * nao com espaco comum. Transcrever o valor a mao no teste produz uma string
 * visualmente identica e diferente byte a byte — e um diff impossivel de ler.
 * Formatando aqui, o que o teste fixa e a estrutura: cabecalho, numeracao,
 * ordem e separadores.
 */
const dinheiro = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

function servico(
  servicoid: number,
  descricao: string,
  valor: number,
  ordemServicoId?: number,
): NFSeItemEmissao {
  return { servicoid, quantidade: 1, valor, servico: { descricao }, ordemServicoId };
}

test("com uma OS só, a discriminação é o cabeçalho e a lista numerada", () => {
  const texto = montarDiscriminacaoServicos(12, [
    servico(1, "Troca de óleo", 150),
    servico(2, "Alinhamento", 90),
  ]);

  assert.equal(
    texto,
    [
      "OS #12",
      `1. Troca de óleo — 1 un. — ${dinheiro(150)}`,
      `2. Alinhamento — 1 un. — ${dinheiro(90)}`,
    ].join("\n"),
  );
});

/*
 * Um item sem `ordemServicoId` pertence à OS âncora. É o caminho de todas as
 * emissões anteriores ao agrupamento, e precisa sair idêntico.
 */
test("item sem OS declarada cai na âncora, como antes do agrupamento", () => {
  const comDeclaracao = montarDiscriminacaoServicos(12, [servico(1, "Troca de óleo", 150, 12)]);
  const semDeclaracao = montarDiscriminacaoServicos(12, [servico(1, "Troca de óleo", 150)]);
  assert.equal(comDeclaracao, semDeclaracao);
});

test("com várias OS, cada uma ganha cabeçalho e a numeração recomeça", () => {
  const texto = montarDiscriminacaoServicos(12, [
    servico(1, "Troca de óleo", 150, 12),
    servico(2, "Alinhamento", 90, 12),
    servico(3, "Balanceamento", 80, 30),
  ]);

  assert.equal(
    texto,
    [
      "OS #12",
      `1. Troca de óleo — 1 un. — ${dinheiro(150)}`,
      `2. Alinhamento — 1 un. — ${dinheiro(90)}`,
      "OS #30",
      `1. Balanceamento — 1 un. — ${dinheiro(80)}`,
    ].join("\n"),
  );
});

test("as OS saem em ordem crescente, não na ordem de chegada dos itens", () => {
  const texto = montarDiscriminacaoServicos(30, [
    servico(3, "Balanceamento", 80, 30),
    servico(1, "Troca de óleo", 150, 12),
  ]);
  assert.ok(texto.indexOf("OS #12") < texto.indexOf("OS #30"));
});

test("o texto complementar da linha entra indentado abaixo do item", () => {
  const item = servico(1, "Troca de óleo", 150, 12);
  item.descricaoItem = "Óleo sintético 5W30";
  const texto = montarDiscriminacaoServicos(12, [item]);
  assert.match(texto, /\n {3}Óleo sintético 5W30/);
});

/*
 * O limite é o gargalo prático do agrupamento: o padrão Nacional aceita 1.000
 * caracteres em xDescServ. Estourar precisa falhar com uma mensagem que diga o
 * que fazer, nunca truncar texto fiscal.
 */
test("estourar o limite é erro, e a mensagem diz o limite", () => {
  const muitos = Array.from({ length: 40 }, (_, indice) =>
    servico(indice + 1, `Serviço bem descrito número ${indice + 1}`, 100, 12),
  );

  assert.throws(
    () => montarDiscriminacaoServicos(12, muitos, undefined, 1000),
    (erro: Error) => {
      assert.match(erro.message, /1000|1\.000/);
      return true;
    },
  );
});

test("dentro do limite, a discriminação agrupada passa", () => {
  const texto = montarDiscriminacaoServicos(
    12,
    [servico(1, "Troca de óleo", 150, 12), servico(2, "Alinhamento", 90, 30)],
    undefined,
    1000,
  );
  assert.ok(texto.length <= 1000);
  assert.ok(texto.includes("OS #12") && texto.includes("OS #30"));
});

/*
 * O caso que quebrava: a validação tratava `servicoid` como único na lista
 * inteira. Numa OS só isso equivalia à PK de `osservico`, mas duas OS podem
 * ter o mesmo serviço do catálogo — e é o caso mais comum de agrupamento
 * (duas revisões, dois alinhamentos). Recusá-lo impediria justamente o que a
 * emissão em lote existe para fazer.
 */
test("o mesmo serviço em duas OS é aceito e sai sob cada cabeçalho", () => {
  const texto = montarDiscriminacaoServicos(12, [
    servico(7, "Revisão completa", 250, 12),
    servico(7, "Revisão completa", 250, 30),
  ]);

  assert.equal(
    texto,
    [
      "OS #12",
      `1. Revisão completa — 1 un. — ${dinheiro(250)}`,
      "OS #30",
      `1. Revisão completa — 1 un. — ${dinheiro(250)}`,
    ].join("\n"),
  );
});

test("o mesmo serviço repetido na MESMA OS continua sendo recusado", () => {
  assert.throws(
    () =>
      montarDiscriminacaoServicos(12, [
        servico(7, "Revisão completa", 250, 12),
        servico(7, "Revisão completa", 250, 12),
      ]),
    (erro: Error) => {
      assert.match(erro.message, /mais de uma vez/i);
      return true;
    },
  );
});

test("serviço com identificador inválido é recusado por isso, não por duplicidade", () => {
  assert.throws(
    () => montarDiscriminacaoServicos(12, [servico(0, "Serviço sem id", 100, 12)]),
    (erro: Error) => {
      assert.match(erro.message, /identificador inválido/i);
      return true;
    },
  );
});
