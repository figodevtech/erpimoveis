/**
 * Valida a migration do resumo do dashboard de estoque numa transação revertida.
 *
 * Uso:
 *   npm run db:test:dashboard-estoque
 *   npm run db:test:dashboard-estoque -- cespedes
 *
 * A função `dashboard_estoque_resumo()` substitui um cálculo que a rota fazia
 * em JavaScript depois de ler o catálogo inteiro. O que precisa ser provado:
 *
 * 1. As migrations pendentes aplicam sem erro, separadas como o `db push` separa.
 * 2. Sobre os dados reais do banco, a função devolve exatamente o que a rota
 *    antiga devolvia (algoritmo copiado abaixo como referência).
 * 3. O mesmo vale nos casos de borda, forçados dentro da transação: custo 0
 *    caindo para `precocompra`, sem custo nenhum, mínimo negativo e referência vazia.
 * 4. A função não fica executável por anon nem por authenticated.
 *
 * Mesmo cuidado dos demais: cada comando vai como prepared statement e um
 * COMMIT perdido não efetiva nada.
 */
import path from "node:path";
import fs from "node:fs";

import {
  DATABASE_KEYS,
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  readLocalMigrations,
  type DatabaseKey,
} from "./lib";
import { splitLikeSupabaseCli } from "./supabase-splitter";

const BANCOS: DatabaseKey[] = [...DATABASE_KEYS];
const CONTROLE_DE_TRANSACAO = /^(begin|start\s+transaction|commit|end|rollback|abort)\b/i;
const TOLERANCIA = 1e-6;

type ProdutoBruto = {
  id: number;
  titulo: string | null;
  referencia: string | null;
  estoque: number | string | null;
  estoqueminimo: number | string | null;
  ultimovalordecompra: number | string | null;
  precocompra: number | string | null;
};

function semComentariosIniciais(comando: string) {
  return comando.replace(/^(\s*--[^\n]*(\n|$))+/, "").trim();
}

function lerComandos(arquivo: string) {
  const sql = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  const comandos: string[] = [];
  for (const comando of splitLikeSupabaseCli(sql)) {
    const nucleo = semComentariosIniciais(comando);
    if (!nucleo) continue;
    if (/^(begin|commit)$/i.test(nucleo)) continue;
    if (CONTROLE_DE_TRANSACAO.test(nucleo)) {
      throw new Error(`${path.basename(arquivo)}: controle de transação fora do envelope (${nucleo.slice(0, 40)}); recusado.`);
    }
    comandos.push(comando);
  }
  return comandos;
}

// ---- Referência: o cálculo que src/app/api/dashboard/estoque/route.ts fazia ----
function numero(valor: unknown) {
  const resultado = Number(valor ?? 0);
  return Number.isFinite(resultado) ? resultado : 0;
}

function resumoDeReferencia(produtos: ProdutoBruto[]) {
  let unidades = 0;
  let valorEstoque = 0;
  let zerados = 0;
  let abaixoMinimo = 0;
  let adequados = 0;
  let semCusto = 0;

  const detalhados = produtos.map((produto) => {
    const estoque = numero(produto.estoque);
    const minimo = Math.max(0, numero(produto.estoqueminimo));
    const custo = numero(produto.ultimovalordecompra) || numero(produto.precocompra);
    const valor = Math.max(0, estoque) * custo;

    unidades += Math.max(0, estoque);
    valorEstoque += valor;
    if (custo <= 0) semCusto += 1;
    if (estoque <= 0) zerados += 1;
    else if (estoque <= minimo) abaixoMinimo += 1;
    else adequados += 1;

    return {
      id: Number(produto.id),
      titulo: produto.titulo || `Produto #${produto.id}`,
      referencia: produto.referencia || null,
      estoque,
      minimo,
      custo,
      valor,
      reposicaoSugerida: Math.max(0, minimo - estoque),
    };
  });

  const reposicao = detalhados
    .filter((produto) => produto.estoque <= produto.minimo)
    .sort((a, b) => {
      const aZerado = a.estoque <= 0 ? 1 : 0;
      const bZerado = b.estoque <= 0 ? 1 : 0;
      return bZerado - aZerado || b.reposicaoSugerida - a.reposicaoSugerida || a.estoque - b.estoque;
    })
    .slice(0, 10);

  const maiorValor = detalhados
    .filter((produto) => produto.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8);

  return {
    totais: { produtos: produtos.length, unidades, valorEstoque, zerados, abaixoMinimo, adequados, semCusto },
    reposicao,
    maiorValor,
  };
}
// ---------------------------------------------------------------------------

function iguais(a: unknown, b: unknown) {
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y) && typeof a !== "string") {
    return Math.abs(x - y) <= TOLERANCIA * Math.max(1, Math.abs(x), Math.abs(y));
  }
  return a === b;
}

function comparar(cenario: string, esperado: ReturnType<typeof resumoDeReferencia>, obtido: any) {
  const diferencas: string[] = [];
  for (const [campo, valor] of Object.entries(esperado.totais)) {
    if (!iguais(valor, numero(obtido?.totais?.[campo]))) {
      diferencas.push(`totais.${campo}: esperado ${valor}, função ${obtido?.totais?.[campo]}`);
    }
  }
  for (const lista of ["reposicao", "maiorValor"] as const) {
    const esperados = esperado[lista];
    const obtidos: any[] = Array.isArray(obtido?.[lista]) ? obtido[lista] : [];
    if (esperados.length !== obtidos.length) {
      diferencas.push(`${lista}: esperado ${esperados.length} itens, função ${obtidos.length}`);
      continue;
    }
    esperados.forEach((item, indice) => {
      for (const [campo, valor] of Object.entries(item)) {
        const recebido = campo === "titulo" || campo === "referencia" ? obtidos[indice]?.[campo] ?? null : numero(obtidos[indice]?.[campo]);
        if (!iguais(valor, recebido)) {
          diferencas.push(`${lista}[${indice}].${campo}: esperado ${valor}, função ${recebido}`);
        }
      }
    });
  }
  if (diferencas.length) throw new Error(`${cenario}: função diverge da rota antiga:\n  - ${diferencas.slice(0, 20).join("\n  - ")}`);
  console.log(
    `  ${cenario}: igual à rota antiga (${esperado.totais.produtos} produtos, ` +
      `${esperado.reposicao.length} em reposição, ${esperado.maiorValor.length} de maior valor)`,
  );
}

async function main() {
  const chave = (process.argv[2] ?? "cespedes") as DatabaseKey;
  if (!BANCOS.includes(chave)) throw new Error(`Banco inválido: ${chave}. Use um de: ${BANCOS.join(", ")}.`);
  const banco = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!banco) throw new Error(`Banco ${chave} não configurado.`);

  const { client } = await connectDatabase(banco);
  client.on("notice", (notice) => {
    if (notice.message && !/already exists|does not exist|skipping/i.test(notice.message)) {
      console.log(`  ${notice.message}`);
    }
  });

  const guarda = async (depois: string) => {
    const { rows } = await client.query("SELECT current_setting('dashboard_estoque_teste.guarda', true) AS guarda");
    if (rows[0]?.guarda !== "ativa") {
      throw new Error(`A transação do teste foi encerrada depois de ${depois}. Verifique o banco.`);
    }
  };

  const lerProdutos = async () =>
    (await client.query<ProdutoBruto>(
      `SELECT id, titulo, referencia, estoque, estoqueminimo, ultimovalordecompra, precocompra
         FROM public.produto WHERE is_deleted = false ORDER BY id ASC`,
    )).rows;
  const lerFuncao = async () =>
    (await client.query("SELECT public.dashboard_estoque_resumo() AS resumo")).rows[0]?.resumo;

  try {
    console.log(`Validando o resumo do dashboard de estoque em ${banco.label}...`);
    const { rows: historico } = await client.query<{ version: string }>(
      "SELECT version FROM supabase_migrations.schema_migrations",
    );
    const aplicadas = new Set(historico.map((row) => String(row.version)));
    const pendentes = readLocalMigrations().filter((migration) => !aplicadas.has(migration.version));
    const scripts = pendentes.map((migration) => ({
      migration,
      comandos: lerComandos(path.join(projectRoot, "supabase", "migrations", migration.file)),
    }));
    let preparados = 0;

    await client.query("BEGIN");
    await client.query("SET LOCAL dashboard_estoque_teste.guarda = 'ativa'");

    for (const { migration, comandos } of scripts) {
      for (const [indice, comando] of comandos.entries()) {
        try {
          await client.query({ name: `dashboard_estoque_teste_${preparados++}`, text: comando });
        } catch (error) {
          const detalhe = error instanceof Error ? error.message : String(error);
          throw new Error(`${migration.file}, comando ${indice}: ${detalhe}`);
        }
      }
      await guarda(migration.file);
      console.log(`  ${migration.file}: aplicada (${comandos.length} comandos)`);
    }

    comparar("dados reais", resumoDeReferencia(await lerProdutos()), await lerFuncao());

    // Casos de borda sobre produtos existentes; tudo volta no ROLLBACK.
    const { rows: alvos } = await client.query<{ id: number }>(
      "SELECT id FROM public.produto WHERE is_deleted = false ORDER BY id ASC LIMIT 4",
    );
    if (alvos.length === 4) {
      const [a, b, c, d] = alvos.map((row) => row.id);
      await client.query("UPDATE public.produto SET ultimovalordecompra = 0, precocompra = 7.25, estoque = 3 WHERE id = $1", [a]);
      await client.query("UPDATE public.produto SET ultimovalordecompra = NULL, precocompra = NULL WHERE id = $1", [b]);
      await client.query("UPDATE public.produto SET estoqueminimo = -5, estoque = -2 WHERE id = $1", [c]);
      await client.query("UPDATE public.produto SET referencia = '', estoqueminimo = 50, estoque = 0 WHERE id = $1", [d]);
      await guarda("casos de borda");
      comparar("casos de borda", resumoDeReferencia(await lerProdutos()), await lerFuncao());
    } else {
      console.log("  casos de borda: banco com menos de 4 produtos, pulado.");
    }

    const { rows: privilegios } = await client.query(
      `SELECT has_function_privilege('anon', 'public.dashboard_estoque_resumo()', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.dashboard_estoque_resumo()', 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', 'public.dashboard_estoque_resumo()', 'EXECUTE') AS service_role`,
    );
    const acesso = privilegios[0];
    if (acesso.anon || acesso.authenticated || !acesso.service_role) {
      throw new Error(`Privilégios incorretos em dashboard_estoque_resumo(): ${JSON.stringify(acesso)}`);
    }
    console.log("  dashboard_estoque_resumo(): só service_role executa.");

    await guarda("verificações");
    await client.query("ROLLBACK");
    console.log(`OK - ${pendentes.length} migration(s) validadas em ${banco.label}; transação revertida.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
