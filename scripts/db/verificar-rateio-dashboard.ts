/**
 * Confere se o rateio dos gráficos do dashboard financeiro fecha com os KPIs.
 *
 * Puxa as linhas cruas do banco com o mesmo recorte da rota
 * `/api/dashboard/financeiro` e roda as MESMAS funções sobre elas
 * (`valorLiquidoEfetivo`, `acumularMovimento`, `consolidarPorGrupo`,
 * `montarBarras`) — o objetivo é pegar divergência entre o total e o rateio,
 * não reimplementar a regra em SQL e comparar duas invenções.
 *
 * Uso:
 *   npx tsx scripts/db/verificar-rateio-dashboard.ts demir 2026-09-01 2026-09-30
 *   npx tsx scripts/db/verificar-rateio-dashboard.ts demir            # últimos 6 meses
 */
import { connectDatabase, loadDatabaseConfigs, type DatabaseKey } from "./lib";
import { valorLiquidoEfetivo } from "../../src/lib/financeiro/transacao";
import {
  IDENTIDADE_SEM_CONTA,
  acumularMovimento,
  consolidarPorGrupo,
  montarBarras,
  type ChavePlano,
  type IdentidadeDoPlano,
  type MovimentoPorPlanoDeConta,
} from "../../src/lib/financeiro/plano-contas/movimento-por-conta";

const FORTALEZA = "-03:00";
const ENTRADAS = new Set(["RECEITA", "DEPOSITO"]);
const SAIDAS = new Set(["DESPESA", "SAQUE"]);

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const centavos = (v: number) => Math.round(v * 100);

function inicioUtc(dia: string) {
  return new Date(`${dia}T00:00:00${FORTALEZA}`).toISOString();
}
function fimUtc(dia: string) {
  return new Date(new Date(`${dia}T00:00:00${FORTALEZA}`).getTime() + 86_400_000).toISOString();
}

type Periodo = { de: string; ate: string };

function ultimosSeisMeses(): Periodo[] {
  const hoje = new Date();
  const periodos: Periodo[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const ref = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - i, 1));
    const ano = ref.getUTCFullYear();
    const mes = String(ref.getUTCMonth() + 1).padStart(2, "0");
    const ultimo = new Date(Date.UTC(ano, ref.getUTCMonth() + 1, 0)).getUTCDate();
    periodos.push({ de: `${ano}-${mes}-01`, ate: `${ano}-${mes}-${ultimo}` });
  }
  return periodos;
}

async function main() {
  const [bancoArg, deArg, ateArg] = process.argv.slice(2);
  const chave = (bancoArg ?? "demir") as DatabaseKey;
  const configuracao = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!configuracao) throw new Error(`Banco ${chave} não está configurado.`);

  const periodos = deArg && ateArg ? [{ de: deArg, ate: ateArg }] : ultimosSeisMeses();
  // Só vale abrir o rateio linha a linha quando o período foi pedido de propósito.
  const detalhar = Boolean(deArg && ateArg);

  const { client } = await connectDatabase(configuracao);
  console.log(`Banco: ${configuracao.label}\n`);

  try {
    // Catálogo de contas, igual à 3ª consulta da rota.
    const catalogo = await client.query(
      `select c.id, c.codigo, c.nome, c.grupo_id,
              g.id as gid, g.codigo as gcodigo, g.nome as gnome
         from public.planosdeconta c
         left join public.planosdecontagrupos g on g.id = c.grupo_id`,
    );
    const porConta = new Map<number, IdentidadeDoPlano>(
      catalogo.rows.map((c: any) => [
        Number(c.id),
        {
          contaId: Number(c.id),
          contaCodigo: c.codigo ?? null,
          contaNome: c.nome ?? `Conta #${c.id}`,
          grupoId: c.gid != null ? Number(c.gid) : null,
          grupoCodigo: c.gcodigo ?? null,
          grupoNome: c.gnome ?? "Sem grupo",
        },
      ]),
    );
    console.log(`Plano de contas: ${porConta.size} contas cadastradas\n`);

    let algumaDivergencia = false;

    for (const { de, ate } of periodos) {
      const { rows } = await client.query(
        `select id, valor, "valorLiquido", valor_descontos, data, tipo, pendente,
                banco_id, adiantamento_id, categoria, metodopagamento,
                plano_de_conta_id, plano_de_conta
           from public.transacao
          where is_deleted = false and data >= $1 and data < $2
          order by id`,
        [inicioUtc(de), fimUtc(ate)],
      );

      // ---- o mesmo laço da rota ----
      let receita = 0;
      let despesa = 0;
      const porCategoria = new Map<string, { receita: number; despesa: number }>();
      const porPlano = new Map<ChavePlano, MovimentoPorPlanoDeConta>();
      const porMetodo = new Map<string, number>();
      const porDia = new Map<string, { receita: number; despesa: number }>();

      for (const row of rows as any[]) {
        const tipo = String(row.tipo ?? "").toUpperCase();
        const entrada = ENTRADAS.has(tipo);
        const saida = SAIDAS.has(tipo);
        if (!entrada && !saida) continue;

        const valor = valorLiquidoEfetivo(row);
        if (!Number.isFinite(valor) || valor <= 0) continue;
        if (row.pendente === true) continue;
        if (row.banco_id == null || !row.data) continue;

        if (entrada) receita += valor;
        if (saida) despesa += valor;

        const categoria = String(row.categoria ?? "Não informado");
        const balde = porCategoria.get(categoria) ?? { receita: 0, despesa: 0 };
        if (entrada) balde.receita += valor;
        if (saida) balde.despesa += valor;
        porCategoria.set(categoria, balde);

        const identidade =
          row.plano_de_conta_id == null
            ? IDENTIDADE_SEM_CONTA
            : porConta.get(Number(row.plano_de_conta_id)) ?? {
                ...IDENTIDADE_SEM_CONTA,
                contaId: Number(row.plano_de_conta_id),
                contaNome: row.plano_de_conta ?? `Conta #${row.plano_de_conta_id}`,
                grupoNome: "Sem grupo",
              };
        acumularMovimento(porPlano, identidade, entrada ? valor : 0, saida ? valor : 0);

        // Métodos só recebem entradas, como na rota.
        if (entrada) {
          const metodo = String(row.metodopagamento ?? "Não informado");
          porMetodo.set(metodo, (porMetodo.get(metodo) ?? 0) + valor);
        }

        const dia = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Fortaleza",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(row.data));
        const baldeDia = porDia.get(dia) ?? { receita: 0, despesa: 0 };
        if (entrada) baldeDia.receita += valor;
        if (saida) baldeDia.despesa += valor;
        porDia.set(dia, baldeDia);
      }

      const linhas = Array.from(porPlano.values());
      const barrasConta = montarBarras(linhas, "CONTA");
      const barrasGrupo = montarBarras(consolidarPorGrupo(linhas), "GRUPO");
      const soma = (lista: { receita: number; despesa: number }[], campo: "receita" | "despesa") =>
        lista.reduce((t, i) => t + i[campo], 0);

      const conferencias = [
        ["Por categoria", soma([...porCategoria.values()], "receita"), soma([...porCategoria.values()], "despesa")],
        ["Por plano de conta (conta)", soma(barrasConta, "receita"), soma(barrasConta, "despesa")],
        ["Por plano de conta (grupo)", soma(barrasGrupo, "receita"), soma(barrasGrupo, "despesa")],
        ["Fluxo de caixa (por dia)", soma([...porDia.values()], "receita"), soma([...porDia.values()], "despesa")],
        // O pie/ranking de métodos só mostra entradas: a coluna de despesa não se aplica.
        ["Métodos (só entradas)", [...porMetodo.values()].reduce((t, v) => t + v, 0), despesa],
      ] as const;

      console.log(`━━ ${de} a ${ate} ━━  ${rows.length} lançamentos no recorte`);
      console.log(`   KPI Receitas ${brl(receita).padStart(16)}   KPI Despesas ${brl(despesa).padStart(16)}`);

      for (const [rotulo, r, d] of conferencias) {
        const okR = centavos(r) === centavos(receita);
        const okD = centavos(d) === centavos(despesa);
        if (!okR || !okD) algumaDivergencia = true;
        console.log(
          `   ${okR && okD ? "OK  " : "FALHA"} ${rotulo.padEnd(28)} ${brl(r).padStart(16)} ${brl(d).padStart(16)}` +
            (okR && okD ? "" : `   ← difere em ${brl(r - receita)} / ${brl(d - despesa)}`),
        );
      }

      const semConta = linhas.find((l) => l.contaId == null);
      if (semConta) {
        const fatia = receita + despesa > 0 ? ((semConta.receita + semConta.despesa) / (receita + despesa)) * 100 : 0;
        console.log(
          `   Sem plano de conta: ${brl(semConta.receita)} de entrada, ${brl(semConta.despesa)} de saída (${fatia.toFixed(1)}% do movimento)`,
        );
      }
      console.log(`   Barras: ${barrasGrupo.length} grupos, ${barrasConta.length} contas, ${porCategoria.size} categorias, ${porMetodo.size} métodos`);

      if (detalhar) {
        console.log("");
        console.log("   Rateio por grupo do plano de contas (o que o gráfico mostra):");
        for (const b of barrasGrupo) {
          console.log(`     ${b.rotulo.padEnd(32)} entrada ${brl(b.receita).padStart(15)}   saída ${brl(b.despesa).padStart(15)}`);
        }
        console.log(`     ${"= SOMA".padEnd(32)} entrada ${brl(soma(barrasGrupo, "receita")).padStart(15)}   saída ${brl(soma(barrasGrupo, "despesa")).padStart(15)}`);

        console.log("");
        console.log("   Ranking de métodos de pagamento (só entradas):");
        for (const [metodo, valor] of [...porMetodo.entries()].sort((a, b) => b[1] - a[1])) {
          const fatia = receita > 0 ? (valor / receita) * 100 : 0;
          console.log(`     ${metodo.padEnd(32)} ${brl(valor).padStart(15)}   ${fatia.toFixed(1).padStart(5)}%`);
        }
        console.log(`     ${"= SOMA".padEnd(32)} ${brl([...porMetodo.values()].reduce((t, v) => t + v, 0)).padStart(15)}`);
      }
      console.log("");
    }

    console.log(algumaDivergencia ? "RESULTADO: há divergência." : "RESULTADO: todo rateio fecha com os KPIs.");
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
