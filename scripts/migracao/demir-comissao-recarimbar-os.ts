/**
 * Recarimba a comissao de OS ja encerradas, uma a uma, no banco do Demir.
 *
 * Uso:
 *   npm run migracao:demir:comissao -- 133 141               -> so republica os eventos
 *   npm run migracao:demir:comissao -- 145 --recarimbar      -> tambem traz a taxa de hoje
 *   npm run migracao:demir:comissao -- 145 --recarimbar --aplicar
 *
 * Sem `--aplicar` termina em ROLLBACK e so mostra o que faria.
 *
 * AS DUAS OPERACOES SAO SEPARADAS DE PROPOSITO
 * Republicar o evento nao mexe em valor nenhum: reconcilia o financeiro com o
 * que ja esta gravado no vinculo. Serve para OS que perderam a comissao no
 * financeiro sem terem perdido o calculo.
 *
 * `--recarimbar` e o oposto: reescreve a taxa pela do cadastro de hoje. So faz
 * sentido quando a taxa mudou durante a execucao e a OS foi entregue depois.
 * Usar isso numa OS entregue ANTES da mudanca aplicaria retroativamente uma taxa
 * que nao existia -- exatamente o que o carimbo existe para impedir.
 *
 * NAO EXISTE MODO EM MASSA, E ISSO E DE PROPOSITO
 * A reconciliacao reconstroi o conjunto INTEIRO de eventos da OS, nao so a parte
 * de comissao. Medido no Demir: rodar isso nas ~100 OS com servico sem comissao
 * mexeria em RECEITA (+R$ 1.300), DESCONTO (+R$ 1.300) e COMISSAO (+R$ 107) em
 * meses fechados. Por isso este script so aceita OS nomeadas, uma a uma, com o
 * antes e depois na tela -- e o que precisa alcancar a base toda entra por
 * migration, tocando so as linhas certas (20260903180000).
 *
 * POR QUE ESTE SCRIPT EXISTE
 * A migration 20260903160000 fez a taxa acompanhar o cadastro ate a execucao
 * encerrar, e recarimbou o que ainda estava em execucao. OS ja entregues ficam
 * de fora de proposito: o valor delas e historico e mexer nele reescreve mes
 * fechado na DRE.
 *
 * Quando a regra nova teria dado outro resultado -- a taxa mudou durante a
 * execucao e a OS foi entregue depois --, a correcao e caso a caso e passa por
 * aqui, com a OS nomeada por quem decide.
 *
 * O QUE FAZ, POR OS
 *   1. com `--recarimbar`: traz `comissao_percent_aplicada` do cadastro atual
 *      (servico sem comissao carimba zero) e recalcula base, percentual efetivo
 *      e valor de cada vinculo;
 *   2. sempre: reconcilia os eventos financeiros com comissao, para o
 *      financeiro acompanhar o que esta no vinculo.
 *
 * O passo 2 e recusado pelo banco se algum evento ja virou transacao com valor
 * diferente. Nesse caso a OS e pulada inteira e o motivo aparece no relatorio:
 * estornar a transacao antes e decisao de quem opera, nao deste script.
 */
import { connectDatabase, loadDatabaseConfigs } from "../db/lib";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const RECARIMBAR = args.includes("--recarimbar");
const IDS = args
  .filter((arg) => !arg.startsWith("--"))
  .map((arg) => Number(arg))
  .filter((id) => Number.isInteger(id) && id > 0);

type LinhaComissao = {
  servicoid: number;
  servico: string | null;
  usuarioid: string;
  realizador: string | null;
  gera_comissao: boolean;
  pct: string | null;
  efetiva: string | null;
  base: string | null;
  comissao: string | null;
};

const dinheiro = (valor: string | null) =>
  `R$ ${Number(valor ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const pct = (valor: string | null) => `${Number(valor ?? 0)}%`;

async function main() {
  if (IDS.length === 0) {
    throw new Error(
      "Informe ao menos um numero de OS. Ex.: npm run migracao:demir:comissao -- 145",
    );
  }

  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "demir");
  if (!configuracao) throw new Error("Banco 'demir' nao configurado.");

  const { client } = await connectDatabase(configuracao);

  const alvos = IDS;

  console.log(
    `\nComissao em ${configuracao.label} — ${alvos.length} OS: ${alvos.join(", ")}`,
  );
  console.log(
    `ACAO: ${
      RECARIMBAR
        ? "recarimbar pela taxa de hoje + republicar eventos"
        : "republicar eventos (nada de taxa e valor muda)"
    }`,
  );
  console.log(APLICAR ? "MODO: APLICAR (COMMIT)\n" : "MODO: simulacao (ROLLBACK no fim)\n");

  const pulados: Array<{ os: number; motivo: string }> = [];
  let totalAntes = 0;
  let totalDepois = 0;

  try {
    await client.query("BEGIN");

    for (const os of alvos) {
      const cabecalho = await client.query<{ status: string; execucao_fim_em: string | null }>(
        "select status::text as status, execucao_fim_em from public.ordemservico where id = $1",
        [os],
      );

      if (cabecalho.rowCount === 0) {
        pulados.push({ os, motivo: "OS nao encontrada" });
        continue;
      }

      const { status, execucao_fim_em } = cabecalho.rows[0];
      console.log(
        `OS #${os} [${status}] — execucao encerrada em ${
          execucao_fim_em ? new Date(execucao_fim_em).toLocaleString("pt-BR") : "ainda aberta"
        }`,
      );

      const consulta = `
        select r.servicoid,
               s.descricao as servico,
               r.usuarioid::text as usuarioid,
               u.nome as realizador,
               coalesce(s.gera_comissao, true) as gera_comissao,
               r.comissao_percent_aplicada::text as pct,
               r.comissao_percent_efetiva::text as efetiva,
               r.valor_base::text as base,
               r.valor_comissao::text as comissao
          from public.osservico_realizador r
          left join public.servico s on s.id = r.servicoid
          left join public.usuario u on u.id = r.usuarioid
         where r.ordemservicoid = $1
         order by s.descricao, u.nome`;

      const antes = await client.query<LinhaComissao>(consulta, [os]);
      if (antes.rowCount === 0) {
        console.log("   sem realizadores; nada a fazer.\n");
        continue;
      }

      const ponto = await client.query("savepoint antes_da_os");
      void ponto;

      try {
        if (RECARIMBAR) {
          await client.query("select public.recarimbar_comissao_osservico($1, null)", [os]);
          await client.query(
            `select public.recalcular_comissao_osservico($1, s.servicoid)
               from public.osservico s where s.ordemservicoid = $1`,
            [os],
          );
        }

        await client.query(
          "select public.reconciliar_eventos_financeiros_os($1, true)",
          [os],
        );
      } catch (erro: any) {
        await client.query("rollback to savepoint antes_da_os");
        const motivo = String(erro?.message ?? erro).split("\n")[0];
        pulados.push({ os, motivo });
        console.log(`   PULADA: ${motivo}\n`);
        continue;
      }

      const depois = await client.query<LinhaComissao>(consulta, [os]);

      for (const linha of antes.rows) {
        const nova = depois.rows.find(
          (item) => item.servicoid === linha.servicoid && item.usuarioid === linha.usuarioid,
        );
        if (!nova) continue;

        totalAntes += Number(linha.comissao ?? 0);
        totalDepois += Number(nova.comissao ?? 0);

        const mudou =
          linha.pct !== nova.pct ||
          linha.comissao !== nova.comissao ||
          linha.efetiva !== nova.efetiva;

        const rotulo = `${linha.servico ?? `servico ${linha.servicoid}`} · ${linha.realizador ?? linha.usuarioid}`;
        if (!mudou) {
          console.log(`   = ${rotulo}: ${pct(nova.pct)} · ${dinheiro(nova.comissao)}`);
          continue;
        }

        console.log(
          `   ~ ${rotulo}: ${pct(linha.pct)} -> ${pct(nova.pct)} | ` +
            `${dinheiro(linha.comissao)} -> ${dinheiro(nova.comissao)}` +
            (nova.gera_comissao ? "" : "  (servico nao comissiona)"),
        );
      }

      const eventos = await client.query<{ n: string; soma: string }>(
        `select count(*)::text as n, coalesce(sum(valor), 0)::text as soma
           from public.eventos_financeiros
          where ordemservicoid = $1 and origem = 'COMISSAO' and status <> 'CANCELADO'`,
        [os],
      );
      console.log(
        `   eventos de comissao ativos depois: ${eventos.rows[0].n} (${dinheiro(eventos.rows[0].soma)})\n`,
      );
    }

    console.log("---");
    console.log(
      `Comissao somada: ${dinheiro(String(totalAntes))} -> ${dinheiro(String(totalDepois))}` +
        ` (variacao ${dinheiro(String(totalDepois - totalAntes))})`,
    );
    if (pulados.length > 0) {
      console.log(`\nOS puladas (${pulados.length}):`);
      for (const item of pulados) console.log(`  #${item.os}: ${item.motivo}`);
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
