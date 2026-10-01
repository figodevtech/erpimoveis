/**
 * Desfaz o ajuste manual da comissao de um realizador em OS nomeadas, no banco
 * do Demir: a comissao volta a sair da regra (base liquida x taxa efetiva).
 *
 * Uso:
 *   npx tsx scripts/migracao/demir-comissao-voltar-ao-calculo.ts <usuario-uuid> 163 290 350
 *   npx tsx scripts/migracao/demir-comissao-voltar-ao-calculo.ts <usuario-uuid> 163 290 350 --aplicar
 *
 * Sem `--aplicar` termina em ROLLBACK e so mostra o que faria.
 *
 * POR QUE EXISTE
 * O override de comissao (`editarEventoDaOs`) marca o evento `is_manual`, e o
 * gatilho `tg_espelhar_comissao_ajustada` guarda o valor em
 * `osservico_realizador.valor_comissao_manual`. Nao ha caminho na tela para
 * voltar ao automatico. Pedido em 01/10/2026 para o ADRIANO ELETRICISTA, depois
 * de a taxa dele ser trazida para 5% (demir-comissao-taxa-atual-do-mes.ts).
 *
 * O QUE FAZ, POR OS
 *   1. tira `is_manual` dos eventos de comissao de realizacao do usuario;
 *   2. limpa `valor_comissao_manual` dos vinculos dele e recalcula o servico;
 *   3. reconcilia os eventos da OS, que regrava valor, detalhe e snapshot.
 *
 * A reconciliacao reconstroi TODOS os eventos da OS. Por isso cada OS e
 * comparada antes e depois: se qualquer evento que nao seja a comissao deste
 * usuario mudar, a OS volta ao savepoint e e listada como recusada.
 */
import { connectDatabase, loadDatabaseConfigs } from "../db/lib";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USUARIO = args.find((arg) => UUID.test(arg));
const IDS = args.filter((arg) => /^\d+$/.test(arg)).map(Number);

const dinheiro = (valor: unknown) =>
  `R$ ${Number(valor ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Evento = { id: string; origem: string; natureza: string; chave_origem: string; status: string; valor: string; is_manual: boolean; usuarioid: string | null };

async function eventosDaOs(client: any, os: number): Promise<Evento[]> {
  const { rows } = await client.query(
    `select id::text, origem, natureza, chave_origem, status, valor::text, coalesce(is_manual, false) as is_manual,
            usuarioid::text
       from public.eventos_financeiros where ordemservicoid = $1 order by id`,
    [os],
  );
  return rows;
}

async function main() {
  if (!USUARIO || IDS.length === 0) throw new Error("Informe o uuid do realizador e ao menos uma OS.");

  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "demir");
  if (!configuracao) throw new Error("Banco 'demir' nao configurado.");
  const { client } = await connectDatabase(configuracao);

  const recusadas: string[] = [];
  try {
    await client.query("BEGIN");
    const { rows: pessoa } = await client.query("select nome from public.usuario where id = $1", [USUARIO]);
    console.log(`\nComissao de ${pessoa[0]?.nome ?? USUARIO} volta ao calculo em ${configuracao.label}: OS ${IDS.join(", ")}`);
    console.log(APLICAR ? "MODO: APLICAR (COMMIT)\n" : "MODO: simulacao (ROLLBACK no fim)\n");

    for (const os of IDS) {
      await client.query("savepoint os");
      const antes = await eventosDaOs(client, os);
      const doUsuario = (e: Evento) =>
        e.origem === "COMISSAO" && e.usuarioid === USUARIO && !e.chave_origem.startsWith("CRIACAO:");

      if (antes.some((e) => doUsuario(e) && e.status === "CONVERTIDO")) {
        await client.query("rollback to savepoint os");
        recusadas.push(`OS #${os}: a comissao ja virou transacao; exclua a transacao antes.`);
        continue;
      }

      await client.query(
        `update public.eventos_financeiros
            set is_manual = false, updated_at = now()
          where ordemservicoid = $1 and origem = 'COMISSAO' and usuarioid = $2::uuid
            and chave_origem not like 'CRIACAO:%' and status <> 'CANCELADO' and coalesce(is_manual, false)`,
        [os, USUARIO],
      );
      const { rows: servicos } = await client.query<{ servicoid: number }>(
        `update public.osservico_realizador
            set valor_comissao_manual = null, updated_at = now()
          where ordemservicoid = $1 and usuarioid = $2::uuid
          returning servicoid`,
        [os, USUARIO],
      );
      for (const { servicoid } of servicos) {
        await client.query("select public.recalcular_comissao_osservico($1, $2)", [os, servicoid]);
      }

      try {
        await client.query("select public.reconciliar_eventos_financeiros_os($1, true)", [os]);
      } catch (erro: any) {
        await client.query("rollback to savepoint os");
        recusadas.push(`OS #${os}: ${String(erro?.message ?? erro).split("\n")[0]}`);
        continue;
      }

      const depois = await eventosDaOs(client, os);
      const alheios = [...new Set([...antes, ...depois].filter((e) => !doUsuario(e)).map((e) => e.id))];
      const mudou = alheios.filter((id) => {
        const a = antes.find((e) => e.id === id);
        const d = depois.find((e) => e.id === id);
        return !a || !d || a.valor !== d.valor || a.status !== d.status || a.is_manual !== d.is_manual;
      });
      if (mudou.length > 0) {
        await client.query("rollback to savepoint os");
        recusadas.push(`OS #${os}: a reconciliacao mexeria em outros eventos (${mudou.join(", ")}); nada aplicado nesta OS.`);
        continue;
      }

      const { rows: vinculos } = await client.query(
        `select r.servicoid, r.valor_base::text as base, r.comissao_percent_efetiva::text as pct, r.valor_comissao::text as comissao
           from public.osservico_realizador r where r.ordemservicoid = $1 and r.usuarioid = $2::uuid`,
        [os, USUARIO],
      );
      for (const v of vinculos) {
        const a = antes.find((e) => doUsuario(e) && e.chave_origem === `${v.servicoid}:${USUARIO}`);
        const d = depois.find((e) => doUsuario(e) && e.chave_origem === `${v.servicoid}:${USUARIO}`);
        console.log(
          `OS #${os} servico ${v.servicoid}: evento ${dinheiro(a?.valor)}${a?.is_manual ? " (manual)" : ""} -> ${dinheiro(d?.valor)}` +
            `${d?.is_manual ? " (manual)" : ""} | base ${dinheiro(v.base)} x ${Number(v.pct)}% | vinculo ${dinheiro(v.comissao)}`,
        );
        if (d && Number(d.valor) !== Number(v.comissao)) throw new Error(`OS #${os}: evento e vinculo divergem depois do recalculo.`);
      }
      await client.query("release savepoint os");
    }

    if (recusadas.length > 0) {
      console.log(`\nRecusadas (${recusadas.length}):`);
      for (const r of recusadas) console.log(`  ${r}`);
    }

    if (APLICAR) {
      await client.query("COMMIT");
      console.log("\nCOMMIT aplicado.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nROLLBACK: nada foi gravado. Repita com --aplicar para valer.");
    }
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((erro) => {
  console.error(erro?.message ?? erro);
  process.exit(1);
});
