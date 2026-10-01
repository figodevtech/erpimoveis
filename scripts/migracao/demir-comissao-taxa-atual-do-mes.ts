/**
 * Traz a taxa de comissao do cadastro atual para as OS concluidas no periodo,
 * no banco do Demir, sem mexer em comissao ajustada a mao.
 *
 * Uso:
 *   npx tsx scripts/migracao/demir-comissao-taxa-atual-do-mes.ts 2026-09-01
 *   npx tsx scripts/migracao/demir-comissao-taxa-atual-do-mes.ts 2026-09-01 --aplicar
 *
 * Sem `--aplicar` termina em ROLLBACK e so mostra o que faria. A data e o
 * inicio do periodo (fuso da oficina); vale ate hoje.
 *
 * POR QUE EXISTE
 * A taxa congela quando a execucao termina (20260903160000). Em setembro/2026
 * o cadastro do ADRIANO ELETRICISTA passou de vazio para 5% em 11/09, depois
 * de OS dele ja encerradas a 0%; o certo seria ter recalculado na mudanca. A
 * automacao disso fica para depois -- este e o ajuste pontual, pedido para o
 * mes corrente.
 *
 * O QUE FAZ
 *   1. acha os vinculos de OS concluidas no periodo (PAGAMENTO, FATURAMENTO,
 *      CONCLUIDO, com `execucao_fim_em`) cujo servico gera comissao e cuja taxa
 *      difere da do cadastro atual;
 *   2. grava a taxa atual em `comissao_percent_aplicada` e recalcula o servico
 *      (base, percentual efetivo -- maior entre os realizadores -- e valor).
 *
 * O QUE NAO FAZ
 *   - Comissao ajustada a mao no evento da OS fica como esta (decisao do
 *     usuario em 01/10/2026): o recalculo ja preserva `valor_comissao_manual`,
 *     entao so a taxa muda, e o relatorio passa a mostrar "pela regra" com ela.
 *   - Evento financeiro nao e reconciliado: a reconciliacao reconstroi o
 *     conjunto inteiro de eventos da OS (ver demir-comissao-recarimbar-os.ts).
 *     Por isso vinculo com evento automatico que mudaria de valor e recusado e
 *     listado; esse caso passa pelo script de recarimbo, OS a OS.
 */
import { connectDatabase, loadDatabaseConfigs } from "../db/lib";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const INICIO = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));

const dinheiro = (valor: unknown) =>
  `R$ ${Number(valor ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Alvo = {
  os: number;
  servicoid: number;
  usuarioid: string;
  realizador: string;
  taxa_atual: string;
  taxa_antes: string;
  efetiva_antes: string | null;
  comissao_antes: string;
  manual: string | null;
  evento_manual: boolean | null;
};

async function main() {
  if (!INICIO) throw new Error("Informe o inicio do periodo. Ex.: 2026-09-01");

  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "demir");
  if (!configuracao) throw new Error("Banco 'demir' nao configurado.");
  const { client } = await connectDatabase(configuracao);

  console.log(`\nTaxa de comissao atual em ${configuracao.label}, OS concluidas desde ${INICIO}`);
  console.log(APLICAR ? "MODO: APLICAR (COMMIT)\n" : "MODO: simulacao (ROLLBACK no fim)\n");

  try {
    await client.query("BEGIN");

    const { rows: alvos } = await client.query<Alvo>(
      `select r.ordemservicoid as os, r.servicoid, r.usuarioid::text as usuarioid,
              coalesce(u.nome, r.usuarioid::text) as realizador,
              coalesce(u.comissao_percent, 0)::text as taxa_atual,
              coalesce(r.comissao_percent_aplicada, 0)::text as taxa_antes,
              r.comissao_percent_efetiva::text as efetiva_antes,
              coalesce(r.valor_comissao, 0)::text as comissao_antes,
              r.valor_comissao_manual::text as manual,
              e.is_manual as evento_manual
         from public.osservico_realizador r
         join public.ordemservico o on o.id = r.ordemservicoid
         join public.servico s on s.id = r.servicoid
         left join public.usuario u on u.id = r.usuarioid
         left join public.eventos_financeiros e
           on e.ordemservicoid = r.ordemservicoid and e.origem = 'COMISSAO'
          and e.natureza = 'DESPESA' and e.status <> 'CANCELADO'
          and e.chave_origem = r.servicoid || ':' || r.usuarioid
        where coalesce(o.is_deleted, false) = false
          and o.status::text in ('PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO')
          and o.execucao_fim_em >= ($1::date::timestamp at time zone 'America/Fortaleza')
          and coalesce(s.gera_comissao, true)
          and coalesce(u.comissao_percent, 0) <> coalesce(r.comissao_percent_aplicada, 0)
        order by r.ordemservicoid, r.servicoid, u.nome`,
      [INICIO],
    );

    if (alvos.length === 0) {
      console.log("Nenhum vinculo com taxa diferente do cadastro atual. Nada a fazer.");
      await client.query("ROLLBACK");
      return;
    }

    // Serviço inteiro: a taxa efetiva é a maior do grupo, então recalcular um
    // vínculo mexe nos outros realizadores do mesmo serviço.
    const servicos = [...new Map(alvos.map((a) => [`${a.os}:${a.servicoid}`, a])).values()];
    const recusados: string[] = [];

    for (const { os, servicoid } of servicos) {
      await client.query("savepoint servico");
      const doServico = alvos.filter((a) => a.os === os && a.servicoid === servicoid);
      for (const a of doServico) {
        await client.query(
          `update public.osservico_realizador r
              set comissao_percent_aplicada = coalesce(u.comissao_percent, 0), updated_at = now()
             from public.usuario u
            where u.id = r.usuarioid and r.ordemservicoid = $1 and r.servicoid = $2 and r.usuarioid = $3::uuid`,
          [os, servicoid, a.usuarioid],
        );
      }
      await client.query("select public.recalcular_comissao_osservico($1, $2)", [os, servicoid]);

      // Evento automático cujo valor mudaria ficaria divergente do vínculo.
      const { rows: divergentes } = await client.query<{ realizador: string; evento: string; vinculo: string }>(
        `select coalesce(u.nome, r.usuarioid::text) as realizador, e.valor::text as evento, r.valor_comissao::text as vinculo
           from public.osservico_realizador r
           join public.eventos_financeiros e
             on e.ordemservicoid = r.ordemservicoid and e.origem = 'COMISSAO' and e.status <> 'CANCELADO'
            and e.chave_origem = r.servicoid || ':' || r.usuarioid
           left join public.usuario u on u.id = r.usuarioid
          where r.ordemservicoid = $1 and r.servicoid = $2 and e.valor <> r.valor_comissao`,
        [os, servicoid],
      );
      if (divergentes.length > 0) {
        await client.query("rollback to savepoint servico");
        recusados.push(
          `OS #${os} servico ${servicoid}: evento automatico mudaria (${divergentes
            .map((d) => `${d.realizador} ${dinheiro(d.evento)} -> ${dinheiro(d.vinculo)}`)
            .join("; ")}). Use o script de recarimbo nesta OS.`,
        );
        continue;
      }
      await client.query("release savepoint servico");
    }

    const { rows: depois } = await client.query<{
      os: number; servicoid: number; usuarioid: string; aplicada: string; efetiva: string; base: string; comissao: string; manual: string | null;
    }>(
      `select ordemservicoid as os, servicoid, usuarioid::text as usuarioid,
              comissao_percent_aplicada::text as aplicada, comissao_percent_efetiva::text as efetiva,
              valor_base::text as base, valor_comissao::text as comissao, valor_comissao_manual::text as manual
         from public.osservico_realizador
        where (ordemservicoid, servicoid) in (select unnest($1::int[]), unnest($2::int[]))`,
      [servicos.map((s) => s.os), servicos.map((s) => s.servicoid)],
    );

    for (const a of alvos) {
      const d = depois.find((x) => x.os === a.os && x.servicoid === a.servicoid && x.usuarioid === a.usuarioid);
      if (!d) continue;
      const pelaRegra = Math.round(Number(d.base) * Number(d.efetiva)) / 100;
      console.log(
        `OS #${a.os} servico ${a.servicoid} · ${a.realizador}: taxa ${Number(a.taxa_antes)}% -> ${Number(d.aplicada)}%` +
          ` (efetiva ${Number(a.efetiva_antes ?? a.taxa_antes)}% -> ${Number(d.efetiva)}%)` +
          ` | comissao ${dinheiro(a.comissao_antes)} -> ${dinheiro(d.comissao)}` +
          (d.manual != null ? `  [ajuste manual mantido; pela regra ${dinheiro(pelaRegra)}]` : ""),
      );
    }

    // Nos serviços tocados, nenhum evento de comissão ativo pode terminar
    // diferente do vínculo. (OS ainda em execução, como a #148, pode ter evento
    // atrasado que a reconciliação acerta no encerramento; não é deste ajuste.)
    const { rows: conferencia } = await client.query<{ n: string }>(
      `select count(*)::text as n
         from public.eventos_financeiros e
         join public.osservico_realizador r
           on r.ordemservicoid = e.ordemservicoid and e.chave_origem = r.servicoid || ':' || r.usuarioid
        where e.origem = 'COMISSAO' and e.natureza = 'DESPESA' and e.status <> 'CANCELADO'
          and e.valor <> r.valor_comissao
          and (r.ordemservicoid, r.servicoid) in (select unnest($1::int[]), unnest($2::int[]))`,
      [servicos.map((s) => s.os), servicos.map((s) => s.servicoid)],
    );
    console.log(`\nEventos de comissao diferentes do vinculo: ${conferencia[0].n}`);
    if (Number(conferencia[0].n) !== 0) throw new Error("Conferencia falhou; nada foi gravado.");

    if (recusados.length > 0) {
      console.log(`\nRecusados (${recusados.length}):`);
      for (const r of recusados) console.log(`  ${r}`);
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
