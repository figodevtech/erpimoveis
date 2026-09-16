/**
 * Move os parcelamentos de dívida do Simples, no Demir, da conta "Simples
 * Nacional" para a conta "Parcelamentos".
 *
 * Decidido em 15/09/2026. A conta "Simples Nacional" vai para 2.1 — imposto
 * sobre o faturamento do mês —, e nela estavam 126 parcelas de parcelamento de
 * dívida ativa: 119 com competência de agosto/2026, somando R$ 885.614,48, e 7
 * parcelas mensais de outros dois parcelamentos. Pagar parcela de tributo de
 * período anterior é quitar dívida, não imposto do mês: agosto mostrava quase
 * R$ 900 mil de dedução que não pertencia a ele. A própria oficina já tinha a
 * conta "Parcelamentos", fora do resultado, com lançamentos do mesmo tipo.
 *
 * O critério é a descrição conter "parcelamento". O único lançamento que fica é
 * o "DARF SIMPLES NACIONAL", o DAS do mês.
 *
 * O que acontece em cada linha, pelos gatilhos que a tela do financeiro também
 * dispara: o nome da conta gravado na transação acompanha o id, o evento da DRE é
 * cancelado (a conta nova fica fora do resultado) e a troca entra na auditoria.
 * Valor, data, competência, banco e baixa não mudam.
 *
 * A contagem e o valor esperados travam a execução: lançamento novo que caia no
 * critério depois da análise é decisão que ninguém tomou.
 *
 * Uso:
 *   npm run db:mover:parcelamentos-demir              # simula
 *   npm run db:mover:parcelamentos-demir -- --aplicar # grava
 */
import fs from "node:fs";
import path from "node:path";

import { montarArvore, type LinhaDre } from "../../src/app/api/dre/_arvore";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

const APLICAR = process.argv.slice(2).includes("--aplicar");

const CONTA_ORIGEM = { id: 48, nome: "Simples Nacional" };
const CONTA_DESTINO = { id: 172, nome: "Parcelamentos" };

const ESPERADO = { lancamentos: 126, valor: 894512.06 };

const PERIODOS = [
  { rotulo: "set/2025", de: "2025-09-01", ate: "2025-09-30" },
  { rotulo: "out/2025", de: "2025-10-01", ate: "2025-10-31" },
  { rotulo: "dez/2025", de: "2025-12-01", ate: "2025-12-31" },
  { rotulo: "jul/2026", de: "2026-07-01", ate: "2026-07-31" },
  { rotulo: "ago/2026", de: "2026-08-01", ate: "2026-08-31" },
  { rotulo: "2026 (jan-set)", de: "2026-01-01", ate: "2026-09-30" },
];

const brl = (valor: number) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Cliente = Awaited<ReturnType<typeof connectDatabase>>["client"];

async function apurar(client: Cliente, template: number, linhas: Record<string, unknown>[], de: string, ate: string) {
  const { rows } = await client.query(
    "SELECT linha_id, valor, lancamentos FROM public.dre_somar_por_linha($1, $2, $3)",
    [template, `${de}T00:00:00.000Z`, `${ate}T23:59:59.999Z`],
  );
  const soma = new Map<number, { valor: number; lancamentos: number }>(
    rows.map((r) => [Number(r.linha_id), { valor: Number(r.valor), lancamentos: Number(r.lancamentos) }]),
  );
  return new Map<string, LinhaDre>(montarArvore(linhas, soma, new Map()).plano.map((l) => [l.codigo, l]));
}

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!configuracao) throw new Error("O Demir não está configurado.");

  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN");

    const { rows: contas } = await client.query(
      "SELECT id, nome FROM public.planosdeconta WHERE id = ANY($1)",
      [[CONTA_ORIGEM.id, CONTA_DESTINO.id]],
    );
    for (const esperada of [CONTA_ORIGEM, CONTA_DESTINO]) {
      const achada = contas.find((c) => Number(c.id) === esperada.id);
      if (achada?.nome !== esperada.nome) {
        throw new Error(`Conta #${esperada.id} deveria ser "${esperada.nome}"; é "${achada?.nome ?? "inexistente"}".`);
      }
    }

    const { rows: alvo } = await client.query(
      `SELECT t.id, t.valor, coalesce(t.competencia_em, t.data)::date AS competencia, t.descricao
         FROM public.transacao t
        WHERE t.plano_de_conta_id = $1
          AND NOT coalesce(t.is_deleted, false)
          AND t.descricao ILIKE '%parcelamento%'
        ORDER BY t.id`,
      [CONTA_ORIGEM.id],
    );
    const total = Number(alvo.reduce((soma, t) => soma + Number(t.valor), 0).toFixed(2));
    console.log(`Lançamentos de parcelamento em "${CONTA_ORIGEM.nome}": ${alvo.length}, R$ ${brl(total)}.`);

    if (alvo.length !== ESPERADO.lancamentos || total !== ESPERADO.valor) {
      throw new Error(
        `Esperava ${ESPERADO.lancamentos} lançamento(s) e R$ ${brl(ESPERADO.valor)}; o banco mudou desde a análise.`,
      );
    }

    const { rows: template } = await client.query(
      "SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1",
    );
    const templateId = Number(template[0].id);
    const { rows: linhas } = await client.query(
      `SELECT id, codigo, nome, nivel, parent_id, tipo, natureza_dre, formula, sinal, sem_fonte
         FROM public.dre_linha WHERE template_id = $1 AND ativo ORDER BY ordem`,
      [templateId],
    );

    const antes = new Map<string, Map<string, LinhaDre>>();
    for (const p of PERIODOS) antes.set(p.rotulo, await apurar(client, templateId, linhas, p.de, p.ate));

    const ids = alvo.map((t) => Number(t.id));
    const { rowCount } = await client.query(
      `UPDATE public.transacao
          SET plano_de_conta_id = $1, updated_at = now()
        WHERE id = ANY($2) AND plano_de_conta_id = $3`,
      [CONTA_DESTINO.id, ids, CONTA_ORIGEM.id],
    );
    if (rowCount !== ids.length) {
      throw new Error(`Atualizou ${rowCount} de ${ids.length} lançamento(s); nada foi gravado.`);
    }

    // O gatilho tem de ter feito as duas coisas que a tela faria.
    const { rows: conferencia } = await client.query(
      `SELECT count(*) FILTER (WHERE t.plano_de_conta IS DISTINCT FROM $2) AS nome_desatualizado,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM public.eventos_financeiros e
                 WHERE e.source_type = 'TRANSACAO' AND e.source_id = t.id AND e.status = 'ATIVO')) AS ainda_na_dre
         FROM public.transacao t WHERE t.id = ANY($1)`,
      [ids, CONTA_DESTINO.nome],
    );
    if (Number(conferencia[0].nome_desatualizado) > 0 || Number(conferencia[0].ainda_na_dre) > 0) {
      throw new Error(
        `Depois de mover: ${conferencia[0].nome_desatualizado} com nome antigo, ${conferencia[0].ainda_na_dre} ainda na DRE. Nada gravado.`,
      );
    }

    const depois = new Map<string, Map<string, LinhaDre>>();
    for (const p of PERIODOS) depois.set(p.rotulo, await apurar(client, templateId, linhas, p.de, p.ate));

    const indicadores = [
      ["2.1", "Impostos s/ vendas"],
      ["3", "Receita líquida"],
      ["5", "Lucro bruto"],
      ["14", "Resultado líquido"],
    ] as const;
    console.log("\nDRE antes -> depois:");
    console.table(
      PERIODOS.map((p) => {
        const linha: Record<string, string> = { periodo: p.rotulo };
        for (const [codigo, rotulo] of indicadores) {
          const a = antes.get(p.rotulo)!.get(codigo)?.valor ?? 0;
          const d = depois.get(p.rotulo)!.get(codigo)?.valor ?? 0;
          linha[rotulo] = a === d ? brl(a) : `${brl(a)} -> ${brl(d)}`;
        }
        return linha;
      }),
    );

    if (!APLICAR) {
      await client.query("ROLLBACK");
      console.log("\nSimulação — nada gravado. Rode com --aplicar para gravar.");
      return;
    }

    await client.query("COMMIT");

    // Registro local de quais linhas mudaram, para desfazer sem adivinhar.
    const pasta = path.join(projectRoot, "artifacts", "captures", "dre-plano-contas");
    fs.mkdirSync(pasta, { recursive: true });
    const arquivo = path.join(pasta, `parcelamentos-movidos-demir-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(
      arquivo,
      JSON.stringify({ de: CONTA_ORIGEM, para: CONTA_DESTINO, gravadoEm: new Date().toISOString(), lancamentos: alvo }, null, 2),
    );
    console.log(`\nGravado. Lista dos ${ids.length} lançamentos em ${path.relative(projectRoot, arquivo)}.`);
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
