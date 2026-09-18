import assert from "node:assert/strict";
import test from "node:test";

import {
  IDENTIDADE_SEM_CONTA,
  acumularMovimento,
  chaveDoPlano,
  consolidarPorGrupo,
  montarBarras,
  rotuloDoPlano,
  type ChavePlano,
  type MovimentoPorPlanoDeConta,
} from "./movimento-por-conta";

const conta = (
  contaId: number,
  contaNome: string,
  grupoId: number,
  receita: number,
  despesa = 0,
): MovimentoPorPlanoDeConta => ({
  contaId,
  contaCodigo: `${grupoId}.${contaId}`,
  contaNome,
  grupoId,
  grupoCodigo: String(grupoId),
  grupoNome: `Grupo ${grupoId}`,
  receita,
  despesa,
});

test("acumularMovimento soma entradas e saídas na mesma conta", () => {
  const mapa = new Map<ChavePlano, MovimentoPorPlanoDeConta>();
  const identidade = conta(7, "Venda de peças", 1, 0);

  acumularMovimento(mapa, identidade, 100, 0);
  acumularMovimento(mapa, identidade, 50, 0);
  acumularMovimento(mapa, identidade, 0, 30);

  assert.equal(mapa.size, 1);
  assert.deepEqual(
    { receita: mapa.get("7")?.receita, despesa: mapa.get("7")?.despesa },
    { receita: 150, despesa: 30 },
  );
});

test("lançamento sem conta cai numa chave própria, sem se misturar com as demais", () => {
  const mapa = new Map<ChavePlano, MovimentoPorPlanoDeConta>();

  acumularMovimento(mapa, IDENTIDADE_SEM_CONTA, 0, 80);
  acumularMovimento(mapa, conta(7, "Venda de peças", 1, 0), 100, 0);

  assert.deepEqual([...mapa.keys()].sort(), ["7", "SEM_CONTA"]);
  assert.equal(chaveDoPlano(null), "SEM_CONTA");
  assert.equal(chaveDoPlano(7), "7");
});

test("consolidarPorGrupo junta as contas do grupo e preserva o código do grupo", () => {
  const grupos = consolidarPorGrupo([
    conta(1, "Serviços", 3, 100),
    conta(2, "Peças", 3, 40, 10),
    conta(9, "Aluguel", 6, 0, 70),
  ]);

  assert.equal(grupos.length, 2);
  const tres = grupos.find((g) => g.grupoId === 3);
  assert.deepEqual(
    { codigo: tres?.grupoCodigo, nome: tres?.contaNome, receita: tres?.receita, despesa: tres?.despesa },
    { codigo: "3", nome: "Grupo 3", receita: 140, despesa: 10 },
  );
});

test("contas de grupos diferentes com o mesmo nome de grupo não se fundem", () => {
  const mesmoNome = (contaId: number, grupoId: number): MovimentoPorPlanoDeConta => ({
    ...conta(contaId, `Conta ${contaId}`, grupoId, 10),
    grupoNome: "Despesas",
  });

  assert.equal(consolidarPorGrupo([mesmoNome(1, 4), mesmoNome(2, 5)]).length, 2);
});

test("todas as contas viram barra, ordenadas da maior para a menor", () => {
  const linhas = Array.from({ length: 12 }, (_, i) => conta(i + 1, `Conta ${i + 1}`, 1, (12 - i) * 100));
  const barras = montarBarras(linhas, "CONTA");

  assert.equal(barras.length, 12, "nada pode ser cortado: o gráfico rola");
  assert.deepEqual(
    barras.map((b) => b.total),
    [...barras.map((b) => b.total)].sort((a, b) => b - a),
  );
  assert.equal(
    barras.reduce((soma, b) => soma + b.total, 0),
    linhas.reduce((soma, l) => soma + l.receita + l.despesa, 0),
  );
});

test("sem plano de conta fica no fim mesmo sendo o maior movimento", () => {
  const barras = montarBarras(
    [{ ...IDENTIDADE_SEM_CONTA, receita: 99999, despesa: 0 }, conta(1, "Serviços", 1, 10)],
    "CONTA",
  );

  assert.deepEqual(barras.map((b) => b.rotulo), ["1.1 · Serviços", "Sem plano de conta"]);
});

test("linha sem movimento algum não vira barra", () => {
  assert.deepEqual(montarBarras([conta(1, "Serviços", 1, 0, 0)], "CONTA"), []);
});

test("no nível grupo o rótulo usa o código do grupo e nada é cortado", () => {
  const linhas = Array.from({ length: 12 }, (_, i) => conta(i + 1, `Conta ${i + 1}`, i + 1, 100));
  const barras = montarBarras(consolidarPorGrupo(linhas), "GRUPO");

  assert.equal(barras.length, 12);
  assert.equal(barras[0]?.rotulo, "1 · Grupo 1");
});

test("conta sem grupo é rotulada como tal no nível grupo, não como sem plano de conta", () => {
  const orfa: MovimentoPorPlanoDeConta = {
    contaId: 42,
    contaCodigo: null,
    contaNome: "Conta apagada",
    grupoId: null,
    grupoCodigo: null,
    grupoNome: "Sem grupo",
    receita: 0,
    despesa: 90,
  };

  assert.deepEqual(montarBarras(consolidarPorGrupo([orfa]), "GRUPO").map((b) => b.rotulo), ["Sem grupo"]);
});

test("rotuloDoPlano dispensa o código quando não existe", () => {
  assert.equal(rotuloDoPlano(null, "Serviços"), "Serviços");
  assert.equal(rotuloDoPlano("  ", "Serviços"), "Serviços");
  assert.equal(rotuloDoPlano("1.2", "Serviços"), "1.2 · Serviços");
});
