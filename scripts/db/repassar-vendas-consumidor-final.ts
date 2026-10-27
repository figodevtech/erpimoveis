/**
 * Repassa as vendas de um cadastro improvisado de "consumidor" (VENDA BALCÃO,
 * CONSUMIDOR/FINAL/BALCÃO…) para o Consumidor Final do sistema.
 *
 * Uso:
 *   npm run db:consumidor-final:repassar -- <banco> <clienteId>
 *   npm run db:consumidor-final:repassar -- <banco> <clienteId> --aplicar
 *
 * Sem `--aplicar` termina em ROLLBACK: mostra o que faria e desfaz.
 *
 * Vão juntos, como na troca de titularidade da OS, os títulos dessas vendas
 * que eram do cadastro antigo (ou de ninguém): `cliente_id` e nome do pagador
 * passam a ser os do Consumidor Final, e o documento, "NÃO INFORMADO". Título de outro cliente fica
 * onde está. OS, peças, veículos, títulos avulsos e o próprio cadastro antigo
 * não mudam — o Consumidor Final é só da venda.
 *
 * Exige a migration 20261026220000_cliente_consumidor_final aplicada.
 */
import type { Client } from "pg";

import { connectDatabase, loadDatabaseConfigs } from "./lib";

export type ResultadoRepasse = {
  consumidorFinalId: number;
  vendas: number[];
  titulos: number[];
};

/** O repasse em si, dentro da transação de quem chama. */
export async function repassarVendas(client: Client, clienteAntigo: number): Promise<ResultadoRepasse> {
  const temFuncao = await client.query("select to_regprocedure('public.cliente_consumidor_final_id()') is not null as ok");
  if (!temFuncao.rows[0]?.ok) {
    throw new Error("O Consumidor Final não existe neste banco: aplique antes a migration 20261026220000_cliente_consumidor_final.");
  }
  const consumidorFinalId = Number((await client.query("select public.cliente_consumidor_final_id() as id")).rows[0].id);

  const antigo = (
    await client.query("select id, nomerazaosocial, codigo_sistema from public.cliente where id = $1", [clienteAntigo])
  ).rows[0];
  if (!antigo) throw new Error(`Cliente ${clienteAntigo} não encontrado.`);
  if (antigo.codigo_sistema) throw new Error(`O cliente ${clienteAntigo} já é o cadastro do sistema.`);

  const vendas = (
    await client.query<{ id: number }>("select id from public.venda where clienteid = $1 order by id", [clienteAntigo])
  ).rows.map((linha) => Number(linha.id));

  const titulos = vendas.length
    ? (
        await client.query<{ id: number }>(
          `update public.transacao
              set cliente_id = $1,
                  nomepagador = 'CONSUMIDOR FINAL',
                  -- A coluna não aceita vazio; é a convenção dos títulos sem documento.
                  cpfcnpjpagador = 'NÃO INFORMADO',
                  updated_at = now()
            where vendaid = any($2::int[])
              and is_deleted = false
              and (cliente_id = $3 or cliente_id is null)
          returning id`,
          [consumidorFinalId, vendas, clienteAntigo],
        )
      ).rows.map((linha) => Number(linha.id))
    : [];

  if (vendas.length) {
    await client.query("update public.venda set clienteid = $1 where id = any($2::int[])", [consumidorFinalId, vendas]);
  }
  return { consumidorFinalId, vendas, titulos };
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const [banco, idArg] = args.filter((arg) => !arg.startsWith("--"));
  const clienteAntigo = Number(idArg);
  if (!banco || !Number.isSafeInteger(clienteAntigo) || clienteAntigo <= 0) {
    throw new Error("Uso: npm run db:consumidor-final:repassar -- <banco> <clienteId> [--aplicar]");
  }
  const config = loadDatabaseConfigs().find((item) => item.key === banco);
  if (!config) throw new Error(`Banco desconhecido: ${banco}`);

  console.log(`\nVendas do cliente ${clienteAntigo} → Consumidor Final em ${config.label} — ${aplicar ? "GRAVANDO" : "simulação"}\n`);
  const { client } = await connectDatabase(config);
  try {
    await client.query("BEGIN");
    const { consumidorFinalId, vendas, titulos } = await repassarVendas(client, clienteAntigo);
    await client.query(aplicar ? "COMMIT" : "ROLLBACK");
    const verbo = aplicar ? "repassadas" : "seriam repassadas (desfeito)";
    console.log(`  Consumidor Final: cliente #${consumidorFinalId}`);
    console.log(`  ${vendas.length} venda(s) ${verbo}: ${vendas.join(", ") || "nenhuma"}`);
    console.log(`  ${titulos.length} título(s) junto: ${titulos.join(", ") || "nenhum"}`);
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    await client.end();
  }
}

// Só roda como comando; o teste importa `repassarVendas`.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("repassar-vendas-consumidor-final.ts")) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
