import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { getTermoAceiteOS, type AceiteAlvo } from "../print-aceite";
import { STATUS_OS_VALIDOS } from "./destaque";
import {
  aplicarVariaveis,
  normalizarTermo,
  resolverTermosOS,
  type AlvoTermo,
} from "./termos-impressao";
import { TERMOS_OS_PADRAO } from "./termos-impressao-padrao";

const ALVOS: AlvoTermo[] = ["VEICULO", "PECA", "EQUIPAMENTO"];

/**
 * O que o cadastro precisa provar: para todo status e todo alvo, os textos
 * padrao resolvem exatamente no que a impressao ja produzia. `getTermoAceiteOS`
 * e a referencia congelada dessa redacao — se um acento ou uma virgula cair no
 * caminho, este teste acusa antes de o documento chegar na mao do cliente.
 */
test("os textos padrão reproduzem, palavra por palavra, os dizeres que já eram impressos", () => {
  for (const status of STATUS_OS_VALIDOS) {
    for (const alvo of ALVOS) {
      const esperado = getTermoAceiteOS(status, alvo as AceiteAlvo);
      const resolvidos = resolverTermosOS(TERMOS_OS_PADRAO, { status, alvo });

      if (!esperado) {
        assert.deepEqual(resolvidos, [], `${status}/${alvo} não deveria imprimir dizeres`);
        continue;
      }

      assert.equal(resolvidos.length, 1, `${status}/${alvo} deveria ter um único bloco`);
      assert.equal(resolvidos[0].titulo, esperado.titulo, `título de ${status}/${alvo}`);
      assert.equal(resolvidos[0].intro, esperado.intro, `introdução de ${status}/${alvo}`);
      assert.deepEqual(resolvidos[0].itens, esperado.itens, `itens de ${status}/${alvo}`);
    }
  }
});

test("OS cancelada não imprime dizeres", () => {
  for (const alvo of ALVOS) {
    assert.deepEqual(resolverTermosOS(TERMOS_OS_PADRAO, { status: "CANCELADO", alvo }), []);
  }
});

test("status desconhecido ou ausente não casa com nenhum bloco", () => {
  assert.deepEqual(resolverTermosOS(TERMOS_OS_PADRAO, { status: "INVENTADO", alvo: "VEICULO" }), []);
  assert.deepEqual(resolverTermosOS(TERMOS_OS_PADRAO, { status: null, alvo: "VEICULO" }), []);
});

test("status chega do banco em caixa e espaçamento variados", () => {
  const comFolga = resolverTermosOS(TERMOS_OS_PADRAO, { status: "  orcamento  ", alvo: "VEICULO" });
  assert.equal(comFolga.length, 1);
  assert.equal(comFolga[0].titulo, "Termo de aceite do orçamento");
});

test("blocos saem na ordem cadastrada, mesmo com vários no mesmo status", () => {
  const termos = [
    { id: 2, titulo: "Segundo", intro: "", itens: ["b"], status: ["CONCLUIDO" as const], alvos: ["VEICULO" as const], ordem: 20 },
    { id: 1, titulo: "Primeiro", intro: "", itens: ["a"], status: ["CONCLUIDO" as const], alvos: ["VEICULO" as const], ordem: 10 },
  ];

  const resolvidos = resolverTermosOS(termos, { status: "CONCLUIDO", alvo: "VEICULO" });
  assert.deepEqual(resolvidos.map((termo) => termo.titulo), ["Primeiro", "Segundo"]);
});

test("bloco sem status ou sem alvo fica guardado sem imprimir", () => {
  const semStatus = { id: 1, titulo: "T", intro: "", itens: ["a"], status: [], alvos: ["VEICULO" as const], ordem: 0 };
  const semAlvo = { id: 2, titulo: "T", intro: "", itens: ["a"], status: ["CONCLUIDO" as const], alvos: [], ordem: 0 };

  assert.deepEqual(resolverTermosOS([semStatus], { status: "CONCLUIDO", alvo: "VEICULO" }), []);
  assert.deepEqual(resolverTermosOS([semAlvo], { status: "CONCLUIDO", alvo: "VEICULO" }), []);
});

test("as variáveis viram o nome do alvo e os dados da OS", () => {
  const ctx = { alvo: "PECA" as const, empresaNome: "Oficina Central", osNumero: 482, clienteNome: "Maria" };

  assert.equal(aplicarVariaveis("Retirar a {{alvo}} na {{empresa_nome}}", ctx), "Retirar a peça/componente na Oficina Central");
  assert.equal(aplicarVariaveis("OS {{os_numero}} de {{cliente_nome}}", ctx), "OS 482 de Maria");
  assert.equal(aplicarVariaveis("{{ alvo }}", ctx), "peça/componente");
});

test("variável desconhecida ou sem valor fica visível no texto", () => {
  // Apagar deixaria uma frase truncada num documento que o cliente assina.
  assert.equal(aplicarVariaveis("Ver {{inexistente}}", { alvo: "VEICULO" }), "Ver {{inexistente}}");
  assert.equal(aplicarVariaveis("Ver {{empresa_nome}}", { alvo: "VEICULO" }), "Ver {{empresa_nome}}");
});

test("normalizarTermo descarta lixo sem derrubar o bloco", () => {
  const termo = normalizarTermo({
    id: 7,
    titulo: "  Termo  ",
    intro: "  Declaro:  ",
    itens: ["  primeiro  ", "", "   ", "segundo"],
    status: ["concluido", "INVENTADO", "CONCLUIDO"],
    alvos: ["peca", "MARCIANO", "VEICULO"],
    ordem: "30",
  });

  assert.ok(termo);
  assert.equal(termo.titulo, "Termo");
  assert.equal(termo.intro, "Declaro:");
  assert.deepEqual(termo.itens, ["primeiro", "segundo"]);
  assert.deepEqual(termo.status, ["CONCLUIDO"]);
  assert.deepEqual(termo.alvos, ["VEICULO", "PECA"]);
  assert.equal(termo.ordem, 30);
});

test("normalizarTermo recusa bloco sem título ou sem item", () => {
  assert.equal(normalizarTermo({ titulo: "   ", itens: ["a"] }), null);
  assert.equal(normalizarTermo({ titulo: "Termo", itens: [] }), null);
  assert.equal(normalizarTermo({ titulo: "Termo", itens: ["   "] }), null);
  assert.equal(normalizarTermo(null), null);
  assert.equal(normalizarTermo([]), null);
});

test("normalizarTermo usa o id de fallback e zera ordem inválida", () => {
  const termo = normalizarTermo({ titulo: "Termo", itens: ["a"], ordem: -5 }, 42);
  assert.ok(termo);
  assert.equal(termo.id, 42);
  assert.equal(termo.ordem, 0);
});


/**
 * A migration semeia os mesmos cinco blocos, em SQL. Sao duas copias do mesmo
 * texto juridico — inevitavel, porque o banco nao le TypeScript — entao aqui
 * elas sao confrontadas: mexer em uma sem mexer na outra quebra o teste.
 */
test("o seed da migration carrega exatamente os textos padrão", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260911160000_os_termo_impressao.sql"),
    "utf8",
  );

  for (const termo of TERMOS_OS_PADRAO) {
    assert.ok(migration.includes(termo.titulo), `a migration não semeia o título "${termo.titulo}"`);
    assert.ok(migration.includes(termo.intro), `a migration não semeia a introdução "${termo.intro}"`);

    for (const item of termo.itens) {
      assert.ok(
        migration.includes(JSON.stringify(item).slice(1, -1)),
        `a migration não semeia o item "${item.slice(0, 60)}..."`,
      );
    }

    for (const status of termo.status) {
      assert.ok(migration.includes(`'${status}'`), `a migration não semeia o status ${status}`);
    }
  }

  // E o seed nao pode atropelar quem ja personalizou.
  assert.ok(
    /WHERE NOT EXISTS \(SELECT 1 FROM public\.os_termo_impressao\)/.test(migration),
    "o seed precisa ser condicionado a uma tabela vazia",
  );
});
