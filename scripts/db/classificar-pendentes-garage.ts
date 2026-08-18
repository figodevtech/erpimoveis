/**
 * Fecha as pendencias de classificacao do Garage Premium.
 *
 * Depois de semear o plano de contas (`db:semear:plano-garage`) sobraram duas
 * coisas para o Garage aparecer inteiro na DRE:
 *
 * 1. O grupo "Despesas comerciais" e o unico sem destino no template. Ele nasceu
 *    assim — a semeadura automatica do mapeamento casa por palavra-chave no nome
 *    do grupo e esse nao casou. Com contas dentro dele agora, o que for lancado
 *    ali cairia fora do relatorio sem aviso. Vai para 6.1, que e a linha com o
 *    mesmo nome no template.
 *
 * 2. As duas transacoes que a conferencia acusa como fora da DRE:
 *
 *      #194  R$ 3.050,00  13/08  categoria "PECA"        boletos RRD241, parcela 3/5
 *      #10   R$    40,00  07/08  categoria "ALIMENTACAO" compra de lanche da oficina
 *
 *    A conta de cada uma vem da categoria que a pessoa ja tinha escolhido:
 *    peca para revenda e custo direto; lanche da equipe e beneficio, dentro de
 *    pessoal. Nao ha adivinhacao aqui — se a categoria nao dissesse, o certo
 *    seria deixar sem classificacao e perguntar.
 *
 * Uso:
 *   npm run db:classificar:garage                # simula
 *   npm run db:classificar:garage -- --aplicar   # grava
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";

const APLICAR = process.argv.slice(2).includes("--aplicar");

/** Transacao -> nome da conta que a recebe. */
const CLASSIFICACAO: Array<{ transacao: number; conta: string; porque: string }> = [
  {
    transacao: 194,
    conta: "Compra de peças para revenda",
    porque: 'categoria "PEÇA"',
  },
  {
    transacao: 10,
    conta: "Benefícios",
    porque: 'categoria "ALIMENTAÇÃO" — lanche da equipe',
  },
];

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "garage");
  if (!configuracao) throw new Error("O Garage Premium não está configurado.");

  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN");

    /* ---------------- 1. o grupo sem destino ---------------- */

    const { rows: semDestino } = await client.query(
      `SELECT g.id, g.nome
         FROM public.planosdecontagrupos g
        WHERE NOT EXISTS (SELECT 1 FROM public.dre_mapeamento mp
                           WHERE mp.origem_tipo = 'PLANO_GRUPO'
                             AND mp.origem_id = g.id AND mp.ativo)`,
    );

    for (const grupo of semDestino) {
      const { rows: linha } = await client.query(
        `SELECT dl.id, dl.codigo, dl.nome
           FROM public.dre_linha dl
           JOIN public.dre_template t ON t.id = dl.template_id AND t.ativo
          WHERE lower(dl.nome) = lower($1) AND dl.tipo = 'DETALHE'
          LIMIT 1`,
        [grupo.nome],
      );

      if (linha.length === 0) {
        console.log(`  grupo "${grupo.nome}" sem destino e sem linha de mesmo nome — deixe manual`);
        continue;
      }

      await client.query(
        `INSERT INTO public.dre_mapeamento
           (template_id, linha_id, origem_tipo, origem_id, percentual, observacao)
         SELECT t.id, $1, 'PLANO_GRUPO', $2, 100, $3
           FROM public.dre_template t WHERE t.ativo`,
        [
          linha[0].id,
          grupo.id,
          "Ligado na revisao do plano de contas do Garage; o nome do grupo nao casou com a semeadura automatica.",
        ],
      );

      console.log(`  grupo "${grupo.nome}" -> linha ${linha[0].codigo} ${linha[0].nome}`);
    }

    if (semDestino.length === 0) console.log("  nenhum grupo sem destino");

    /* ---------------- 2. as transacoes ---------------- */

    console.log("");
    for (const item of CLASSIFICACAO) {
      const { rows: conta } = await client.query(
        `SELECT pc.id, pc.codigo, pc.nome, g.nome AS grupo
           FROM public.planosdeconta pc
           JOIN public.planosdecontagrupos g ON g.id = pc.grupo_id
          WHERE pc.nome = $1 LIMIT 1`,
        [item.conta],
      );
      if (conta.length === 0) throw new Error(`Conta "${item.conta}" não existe no plano.`);

      const { rows: antes } = await client.query(
        `SELECT id, valor, plano_de_conta_id, coalesce(descricao, '') AS descricao
           FROM public.transacao WHERE id = $1`,
        [item.transacao],
      );
      if (antes.length === 0) throw new Error(`Transação #${item.transacao} não existe.`);
      if (antes[0].plano_de_conta_id != null) {
        throw new Error(`Transação #${item.transacao} já tem conta. Nada a fazer.`);
      }

      await client.query(
        `UPDATE public.transacao SET plano_de_conta_id = $2, updated_at = now() WHERE id = $1`,
        [item.transacao, conta[0].id],
      );

      console.log(
        `  #${item.transacao} R$ ${antes[0].valor} -> ${conta[0].codigo} ${conta[0].nome} ` +
          `(${conta[0].grupo}) · ${item.porque}`,
      );
    }

    /* ---------------- conferência ---------------- */

    const { rows: conferencia } = await client.query(
      `SELECT
         (SELECT count(*) FROM public.eventos_financeiros e
           WHERE e.source_type = 'TRANSACAO' AND e.status IN ('ATIVO','CONVERTIDO')
             AND e.competencia_em IS NOT NULL AND e.dre_linha_id IS NULL) AS eventos_sem_linha,
         (SELECT count(*) FROM public.planosdecontagrupos g
           WHERE NOT EXISTS (SELECT 1 FROM public.dre_mapeamento mp
                              WHERE mp.origem_tipo='PLANO_GRUPO' AND mp.origem_id=g.id
                                AND mp.ativo)) AS grupos_sem_destino`,
    );

    console.log("\nConferência:", conferencia[0]);

    if (APLICAR) {
      await client.query("COMMIT");
      console.log("\nAplicado.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nSimulação — nada foi gravado. Rode com --aplicar para valer.");
    }
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`\nNada foi gravado: ${erro instanceof Error ? erro.message : erro}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
