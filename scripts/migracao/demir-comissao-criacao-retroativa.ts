/**
 * Apura a comissao de criacao nas OS que ja estavam abertas quando o beneficio
 * foi ligado, no banco do Demir.
 *
 * Uso:
 *   npm run migracao:demir:comissao-criacao -- --usuario=<uuid> --mes=2026-09
 *   npm run migracao:demir:comissao-criacao -- --usuario=<uuid> --mes=2026-09 --aplicar
 *
 * Sem `--aplicar` termina em ROLLBACK e so mostra o que faria.
 *
 * POR QUE ESTE SCRIPT EXISTE
 * O percentual foi cadastrado depois de as OS do mes ja terem sido criadas e,
 * em boa parte, encerradas. A regra normal nao alcanca nenhuma das duas
 * situacoes:
 *
 *   - OS ENCERRADA nunca apurada nao ganha comissao depois (guarda de
 *     20260904130000). Aqui ela e apurada com `p_forcar`, que existe justamente
 *     para a decisao tomada por uma pessoa, OS a OS.
 *
 *   - OS AINDA ABERTA seria apurada sozinha, mas so no proximo gatilho: um item
 *     que mude, o orcamento que seja salvo. Enquanto ninguem tocar nela, nao ha
 *     linha nem evento. O script antecipa isso.
 *
 * O QUE ELE NAO FAZ
 * Nao inventa numero: chama `recalcular_comissao_criacao_os`, a mesma funcao dos
 * gatilhos, e depois `reconciliar_eventos_financeiros_os` para o evento sair.
 * Se a formula estiver errada, esta errada nos dois caminhos — que e o ponto.
 *
 * Nao toca em OS CANCELADA nem SEM_COBRANCA: as duas nao comissionam, e a
 * segunda perde a comissao por regra na troca de status.
 *
 * O RECORTE E O MES DA EXECUCAO ENCERRADA
 * `execucao_fim_em`, o mesmo eixo da Central Pessoal e dos relatorios de
 * comissao. OS ainda aberta entra independentemente do mes: ali nao ha
 * retroatividade nenhuma, so antecipacao do que o gatilho faria.
 *
 * CUIDADO
 * Publicar comissao nova mexe na DRE do mes alcancado. Rodar isto num mes ja
 * fechado e conferido reescreve aquele periodo — por isso o mes e um argumento
 * obrigatorio, e nao um intervalo aberto.
 */
import { connectDatabase, loadDatabaseConfigs } from "../db/lib";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");

function opcao(nome: string) {
  const achado = args.find((arg) => arg.startsWith(`--${nome}=`));
  return achado ? achado.slice(nome.length + 3) : "";
}

const USUARIO = opcao("usuario");
const MES = opcao("mes");

/** Status em que a comissao ja e publicada como evento financeiro. */
const STATUS_COM_EVENTO = ["EM_ANDAMENTO", "PAGAMENTO", "CONCLUIDO"];

type LinhaOs = {
  id: number;
  status: string;
  encerrada: boolean;
  execucao_fim_em: string | null;
};

/** O apurado da OS, somado a partir das linhas por item. */
type Apuracao = {
  itens: string;
  valor_servicos: string;
  valor_produtos: string;
  valor_comissao: string;
};

const real = (valor: unknown) =>
  Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
  if (!USUARIO || !MES || !/^\d{4}-\d{2}$/.test(MES)) {
    throw new Error(
      "Informe --usuario=<uuid> e --mes=AAAA-MM. Ex.: --usuario=ccb0ca64-... --mes=2026-09",
    );
  }

  const inicio = `${MES}-01T00:00:00-03:00`;
  const fim = new Date(new Date(inicio).getTime());
  fim.setMonth(fim.getMonth() + 1);

  const config = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!config) throw new Error("Banco do Demir nao encontrado.");

  const { client } = await connectDatabase(config);
  try {
    const { rows: usuario } = await client.query(
      `SELECT nome, comissao_criacao_servico_percent AS pct_servicos,
              comissao_criacao_produto_percent AS pct_produtos,
              comissao_criacao_somente_comissionaveis AS somente
         FROM public.usuario WHERE id = $1`,
      [USUARIO],
    );
    if (!usuario.length) throw new Error(`Usuario ${USUARIO} nao existe no Demir.`);

    const dono = usuario[0];
    if (!Number(dono.pct_servicos) && !Number(dono.pct_produtos)) {
      throw new Error(
        `${dono.nome} nao tem percentual de comissao de criacao cadastrado. ` +
          "Preencha no cadastro antes de apurar.",
      );
    }

    console.log(`\n${config.label} — ${dono.nome}`);
    console.log(
      `Cadastro: ${dono.pct_servicos}% servicos · ${dono.pct_produtos}% produtos · ` +
        (dono.somente ? "so servicos que geram comissao" : "todos os servicos"),
    );
    console.log(`Recorte: encerradas em ${MES} + todas as que ainda nao encerraram\n`);

    // Encerradas no mes pedido, mais as que ainda nao encerraram. Canceladas e
    // sem cobranca ficam de fora: nao comissionam.
    const { rows: ordens } = await client.query<LinhaOs>(
      `SELECT o.id, o.status::text AS status,
              o.execucao_fim_em IS NOT NULL AS encerrada,
              to_char(o.execucao_fim_em AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY') AS execucao_fim_em
         FROM public.ordemservico o
        WHERE o.usuariocriadorid = $1
          AND o.is_deleted = false
          AND o.status::text NOT IN ('CANCELADO', 'SEM_COBRANCA')
          AND (
            (o.execucao_fim_em >= $2::timestamptz AND o.execucao_fim_em < $3::timestamptz)
            OR o.execucao_fim_em IS NULL
          )
        ORDER BY o.execucao_fim_em NULLS LAST, o.id`,
      [USUARIO, inicio, fim.toISOString()],
    );

    if (!ordens.length) {
      console.log("Nenhuma OS no recorte.\n");
      return;
    }

    await client.query("BEGIN");

    let total = 0;
    let comEvento = 0;
    const pulados: string[] = [];

    for (const os of ordens) {
      await client.query("SELECT public.recalcular_comissao_criacao_os($1, true)", [os.id]);

      // Uma linha por item; o relatório mostra o total da OS, separando o que
      // veio de serviço do que veio de produto.
      const { rows: apurado } = await client.query<Apuracao>(
        `SELECT count(*)::text AS itens,
                round(coalesce(sum(valor_comissao) FILTER (WHERE tipo = 'SERVICO'), 0), 2) AS valor_servicos,
                round(coalesce(sum(valor_comissao) FILTER (WHERE tipo <> 'SERVICO'), 0), 2) AS valor_produtos,
                round(coalesce(sum(valor_comissao), 0), 2) AS valor_comissao
           FROM public.os_comissao_criacao
          WHERE ordemservicoid = $1
         HAVING count(*) > 0`,
        [os.id],
      );

      if (!apurado.length) {
        pulados.push(`#${os.id}: nada a apurar (OS sem itens ou sem criador)`);
        continue;
      }

      const linha = apurado[0];
      total += Number(linha.valor_comissao);

      let evento = "—";
      if (STATUS_COM_EVENTO.includes(os.status)) {
        try {
          // A reconciliacao reconstroi o conjunto INTEIRO de eventos da OS, nao
          // so a comissao. Ela e recusada quando algum evento ja virou transacao
          // com outro valor — nesse caso a OS inteira e pulada, e estornar a
          // transacao antes e decisao de quem opera.
          await client.query("SAVEPOINT reconciliar");
          await client.query("SELECT public.reconciliar_eventos_financeiros_os($1, true)", [os.id]);
          await client.query("RELEASE SAVEPOINT reconciliar");

          // Um evento por item: o que interessa aqui é quantos saíram e se a
          // soma deles bate com o apurado.
          const { rows: publicado } = await client.query(
            `SELECT count(*)::int AS eventos, round(coalesce(sum(valor), 0), 2) AS valor
               FROM public.eventos_financeiros
              WHERE ordemservicoid = $1 AND origem = 'COMISSAO'
                AND chave_origem LIKE 'CRIACAO:' || $2 || ':%' AND status <> 'CANCELADO'`,
            [os.id, USUARIO],
          );
          const eventos = Number(publicado[0]?.eventos ?? 0);
          evento = eventos ? `${eventos}× ${real(publicado[0].valor)}` : "não saiu";
          if (eventos) comEvento += 1;
        } catch (erro) {
          await client.query("ROLLBACK TO SAVEPOINT reconciliar");
          const mensagem = erro instanceof Error ? erro.message : String(erro);
          evento = "recusado";
          pulados.push(`#${os.id}: ${mensagem}`);
        }
      } else {
        evento = "aguarda execução";
      }

      console.log(
        `  #${String(os.id).padEnd(6)} ${os.status.padEnd(14)} ` +
          `${(os.execucao_fim_em ?? "em aberto").padStart(10)}  ` +
          `serv ${real(linha.valor_servicos).padStart(11)} + ` +
          `prod ${real(linha.valor_produtos).padStart(10)} = ` +
          `${real(linha.valor_comissao).padStart(11)}   evento: ${evento}`,
      );
    }

    console.log(`\n  ${ordens.length} OS · ${comEvento} com evento publicado`);
    console.log(`  TOTAL apurado: ${real(total)}`);

    if (pulados.length) {
      console.log(`\n  ${pulados.length} aviso(s):`);
      for (const aviso of pulados) console.log(`    ${aviso}`);
    }

    if (APLICAR) {
      await client.query("COMMIT");
      console.log("\n  APLICADO.\n");
    } else {
      await client.query("ROLLBACK");
      console.log("\n  Simulação — nada foi gravado. Repita com --aplicar.\n");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
