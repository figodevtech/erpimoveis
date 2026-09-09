/**
 * Fase 0 do plano `docs/plano-execucao-plano-contas-dinamico-dre.md`:
 * inventário SOMENTE LEITURA do plano de contas e da classificação da DRE nos
 * quatro bancos.
 *
 * Uso:
 *   npm run db:inventario:dre
 *   npm run db:inventario:dre -- demir
 *   npm run db:inventario:dre -- --meses 12
 *
 * Cada consulta roda dentro de `BEGIN; SET TRANSACTION READ ONLY;`. O script
 * não cria tabela temporária, não chama função volátil e termina com ROLLBACK.
 * Se alguma consulta tentar escrever, o próprio Postgres aborta.
 *
 * A saída vai para `artifacts/captures/dre-plano-contas/`, que o .gitignore já
 * exclui: o inventário carrega nomes de contas e valores dos clientes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  type DatabaseConfig,
  type DatabaseKey,
} from "./lib";

const CHAVES_VALIDAS: DatabaseKey[] = ["demo", "demir", "garage"];

type Consulta = { nome: string; sql: string; params?: unknown[] };

/**
 * Meses de baseline. A DRE atual usa limites UTC; o inventário repete esse
 * critério de propósito, para que a comparação antes/depois não misture uma
 * mudança de fuso com uma mudança de classificação.
 */
function janelaDeMeses(meses: number) {
  const hoje = new Date();
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0));
  const inicio = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() - (meses - 1), 1));
  return {
    de: `${inicio.toISOString().slice(0, 10)}T00:00:00.000Z`,
    ate: `${fim.toISOString().slice(0, 10)}T23:59:59.999Z`,
  };
}

function consultas(janela: { de: string; ate: string }): Consulta[] {
  return [
    {
      nome: "resumo_cadastro",
      sql: `
        SELECT
          (SELECT count(*) FROM public.planosdecontagrupos)                    AS grupos,
          (SELECT count(*) FROM public.planosdecontagrupos WHERE ativo)        AS grupos_ativos,
          (SELECT count(*) FROM public.planosdeconta)                          AS contas,
          (SELECT count(*) FROM public.planosdeconta WHERE ativo)              AS contas_ativas,
          (SELECT count(*) FROM public.dre_template)                           AS templates,
          (SELECT count(*) FROM public.dre_linha)                              AS linhas,
          (SELECT count(*) FROM public.dre_mapeamento)                         AS mapeamentos,
          (SELECT count(*) FROM public.dre_mapeamento WHERE ativo)             AS mapeamentos_ativos`,
    },
    {
      nome: "template_vigente",
      sql: `
        SELECT id, codigo, nome, versao, ativo
          FROM public.dre_template
         ORDER BY ativo DESC, versao DESC`,
    },
    {
      /*
       * Um grupo é a unidade que hoje decide o destino do avulso. Por isso a
       * linha traz, junto, quantas contas dependem dele e quanto já foi lançado:
       * um grupo sem destino com zero lançamentos é um risco futuro; com
       * lançamentos, já é um buraco no resultado.
       */
      nome: "grupos",
      sql: `
        WITH mapa AS (
          SELECT m.origem_id,
                 count(*)                                             AS mapeamentos,
                 bool_or(m.exclui_do_resultado)                        AS exclui,
                 min(l.codigo)                                         AS linha_codigo,
                 min(l.nome)                                           AS linha_nome,
                 min(l.natureza_dre)                                   AS linha_natureza,
                 bool_or(m.percentual <> 100)                          AS tem_rateio,
                 bool_or(m.vigencia_inicio IS NOT NULL
                      OR m.vigencia_fim IS NOT NULL)                   AS tem_vigencia
            FROM public.dre_mapeamento m
            LEFT JOIN public.dre_linha l ON l.id = m.linha_id
           WHERE m.ativo AND m.origem_tipo = 'PLANO_GRUPO'
           GROUP BY m.origem_id
        ),
        uso AS (
          SELECT c.grupo_id,
                 count(*) FILTER (WHERE c.ativo)                       AS contas_ativas,
                 count(*)                                              AS contas,
                 coalesce(sum(t.transacoes), 0)                        AS transacoes
            FROM public.planosdeconta c
            LEFT JOIN LATERAL (
              SELECT count(*) AS transacoes
                FROM public.transacao t
               WHERE t.plano_de_conta_id = c.id
            ) t ON true
           GROUP BY c.grupo_id
        )
        SELECT g.id, g.codigo, g.nome, g.ativo,
               coalesce(u.contas, 0)        AS contas,
               coalesce(u.contas_ativas, 0) AS contas_ativas,
               coalesce(u.transacoes, 0)    AS transacoes,
               coalesce(mapa.mapeamentos, 0) AS mapeamentos,
               mapa.exclui, mapa.linha_codigo, mapa.linha_nome, mapa.linha_natureza,
               coalesce(mapa.tem_rateio, false)   AS tem_rateio,
               coalesce(mapa.tem_vigencia, false) AS tem_vigencia
          FROM public.planosdecontagrupos g
          LEFT JOIN uso u  ON u.grupo_id = g.id
          LEFT JOIN mapa   ON mapa.origem_id = g.id
         ORDER BY g.codigo, g.id`,
    },
    {
      nome: "contas",
      sql: `
        SELECT c.id, c.codigo, c.nome, c.ativo,
               c.grupo_id, g.codigo AS grupo_codigo, g.nome AS grupo_nome, g.ativo AS grupo_ativo,
               (SELECT count(*) FROM public.transacao t WHERE t.plano_de_conta_id = c.id) AS transacoes,
               (SELECT count(*)
                  FROM public.dre_mapeamento m
                 WHERE m.ativo AND m.origem_tipo = 'PLANO_CONTA' AND m.origem_id = c.id) AS mapeamentos_conta
          FROM public.planosdeconta c
          JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
         ORDER BY g.codigo, c.codigo, c.id`,
    },
    {
      /*
       * A revisão registrou que o sincronizador de avulsos lê apenas
       * PLANO_GRUPO. Contar por tipo mostra quanto de mapeamento cadastrado o
       * código simplesmente ignora hoje.
       */
      nome: "mapeamentos_por_tipo",
      sql: `
        SELECT m.origem_tipo, m.ativo,
               count(*)                                       AS total,
               count(*) FILTER (WHERE m.exclui_do_resultado)   AS exclusoes,
               count(*) FILTER (WHERE m.percentual <> 100)     AS com_rateio,
               count(*) FILTER (WHERE m.vigencia_inicio IS NOT NULL
                                   OR m.vigencia_fim IS NOT NULL) AS com_vigencia
          FROM public.dre_mapeamento m
         GROUP BY m.origem_tipo, m.ativo
         ORDER BY m.origem_tipo, m.ativo`,
    },
    {
      nome: "mapeamentos_detalhe",
      sql: `
        SELECT m.id, m.template_id, m.origem_tipo, m.origem_id, m.origem_valor,
               m.linha_id, l.codigo AS linha_codigo, l.natureza_dre AS linha_natureza,
               m.exclui_do_resultado, m.percentual, m.vigencia_inicio, m.vigencia_fim,
               m.ativo, m.centro_custo_id, m.observacao
          FROM public.dre_mapeamento m
          LEFT JOIN public.dre_linha l ON l.id = m.linha_id
         ORDER BY m.origem_tipo, m.origem_id NULLS FIRST, m.origem_valor NULLS FIRST, m.id`,
    },
    {
      /*
       * Mapeamento apontando para origem que não existe mais. `origem_id` é
       * polimórfico e não tem FK: a checagem precisa ser por tipo.
       */
      nome: "mapeamentos_orfaos",
      sql: `
        SELECT m.id, m.origem_tipo, m.origem_id, m.origem_valor, m.ativo
          FROM public.dre_mapeamento m
         WHERE (m.origem_tipo = 'PLANO_GRUPO'
                AND NOT EXISTS (SELECT 1 FROM public.planosdecontagrupos g WHERE g.id = m.origem_id))
            OR (m.origem_tipo = 'PLANO_CONTA'
                AND NOT EXISTS (SELECT 1 FROM public.planosdeconta c WHERE c.id = m.origem_id))
            OR (m.origem_tipo = 'CATEGORIA_TRANSACAO'
                AND NOT EXISTS (SELECT 1 FROM public.categoriatransacao ct WHERE ct.id = m.origem_id))
         ORDER BY m.origem_tipo, m.id`,
    },
    {
      /* Uma origem com mais de um destino ativo e vigente é conflito, não escolha. */
      nome: "mapeamentos_conflitantes",
      sql: `
        SELECT m.template_id, m.origem_tipo, m.origem_id, m.origem_valor,
               count(*) AS destinos, sum(m.percentual) AS percentual_total,
               array_agg(coalesce(l.codigo, 'EXCLUI') ORDER BY m.id) AS destinos_codigo
          FROM public.dre_mapeamento m
          LEFT JOIN public.dre_linha l ON l.id = m.linha_id
         WHERE m.ativo
         GROUP BY m.template_id, m.origem_tipo, m.origem_id, m.origem_valor
        HAVING count(*) > 1
         ORDER BY count(*) DESC, m.origem_tipo`,
    },
    {
      /* Baseline: a mesma soma que a tela usa, mês a mês. */
      nome: "baseline_dre_mensal",
      sql: `
        WITH t AS (
          SELECT id FROM public.dre_template
           WHERE ativo ORDER BY versao DESC LIMIT 1
        ),
        meses AS (
          SELECT generate_series(
                   date_trunc('month', $1::timestamptz),
                   date_trunc('month', $2::timestamptz),
                   interval '1 month') AS inicio
        )
        SELECT to_char(m.inicio, 'YYYY-MM')            AS competencia,
               s.linha_id, l.codigo AS linha_codigo, l.nome AS linha_nome,
               s.valor, s.lancamentos
          FROM meses m
          CROSS JOIN t
          CROSS JOIN LATERAL public.dre_somar_por_linha(
            t.id, m.inicio, (m.inicio + interval '1 month' - interval '1 millisecond')) s
          JOIN public.dre_linha l ON l.id = s.linha_id
         ORDER BY 1, l.ordem`,
      params: [janela.de, janela.ate],
    },
    {
      /*
       * Eventos que não entram em total nenhum. Quantidade E valor: a fila da
       * seção 8.5 precisa dos dois, e um total omitido não é "zero".
       */
      nome: "eventos_sem_linha",
      sql: `
        WITH t AS (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1)
        SELECT to_char(e.competencia_em, 'YYYY-MM') AS competencia,
               e.source_type, e.origem, e.natureza, e.natureza_dre, e.status,
               count(*) AS lancamentos, round(sum(e.valor), 2) AS valor
          FROM public.eventos_financeiros e
          CROSS JOIN t
         WHERE e.status IN ('ATIVO', 'CONVERTIDO')
           AND e.competencia_em BETWEEN $1::timestamptz AND $2::timestamptz
           AND e.dre_linha_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.dre_mapeamento mp
              WHERE mp.template_id = t.id AND mp.ativo
                AND mp.origem_tipo = 'EVENTO_ORIGEM'
                AND mp.origem_valor = e.origem || ':' || e.natureza
                AND (mp.vigencia_inicio IS NULL OR e.competencia_em >= mp.vigencia_inicio)
                AND (mp.vigencia_fim IS NULL OR e.competencia_em <= mp.vigencia_fim)
           )
         GROUP BY 1, 2, 3, 4, 5, 6
         ORDER BY 1 DESC, valor DESC NULLS LAST`,
      params: [janela.de, janela.ate],
    },
    {
      /* Detalhe por conta, para saber qual cadastro precisa de regra. */
      nome: "eventos_sem_linha_por_conta",
      sql: `
        WITH t AS (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1)
        SELECT coalesce(g.nome, '(sem grupo)')  AS grupo_nome,
               coalesce(c.nome, '(sem conta)')  AS conta_nome,
               c.id AS conta_id, g.id AS grupo_id,
               e.natureza, count(*) AS lancamentos, round(sum(e.valor), 2) AS valor
          FROM public.eventos_financeiros e
          CROSS JOIN t
          LEFT JOIN public.transacao tr ON tr.id = e.source_id AND e.source_type = 'TRANSACAO'
          LEFT JOIN public.planosdeconta c ON c.id = tr.plano_de_conta_id
          LEFT JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
         WHERE e.status IN ('ATIVO', 'CONVERTIDO')
           AND e.competencia_em BETWEEN $1::timestamptz AND $2::timestamptz
           AND e.dre_linha_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.dre_mapeamento mp
              WHERE mp.template_id = t.id AND mp.ativo
                AND mp.origem_tipo = 'EVENTO_ORIGEM'
                AND mp.origem_valor = e.origem || ':' || e.natureza
           )
         GROUP BY 1, 2, 3, 4, 5
         ORDER BY valor DESC NULLS LAST`,
      params: [janela.de, janela.ate],
    },
    {
      /*
       * Natureza incompatível: evento de DESPESA numa linha de RECEITA e
       * vice-versa. A revisão encontrou três casos na Demonstração; aqui o
       * inventário mede o problema nos quatro bancos.
       */
      nome: "natureza_incompativel",
      sql: `
        SELECT l.codigo AS linha_codigo, l.nome AS linha_nome, l.natureza_dre AS linha_natureza,
               e.natureza AS evento_natureza, e.natureza_dre AS evento_natureza_dre,
               e.source_type, e.origem,
               count(*) AS lancamentos, round(sum(e.valor), 2) AS valor
          FROM public.eventos_financeiros e
          JOIN public.dre_linha l ON l.id = e.dre_linha_id
         WHERE e.status IN ('ATIVO', 'CONVERTIDO')
           AND e.competencia_em BETWEEN $1::timestamptz AND $2::timestamptz
           AND l.natureza_dre IS NOT NULL
           AND (
             (l.natureza_dre = 'RECEITA' AND e.natureza <> 'RECEITA')
             OR (l.natureza_dre IN ('CUSTO', 'DESPESA') AND e.natureza <> 'DESPESA')
           )
         GROUP BY 1, 2, 3, 4, 5, 6, 7
         ORDER BY valor DESC NULLS LAST`,
      params: [janela.de, janela.ate],
    },
    {
      /*
       * Exclusões: o que sai do resultado por mapeamento explícito. Precisa ser
       * revisado uma a uma — "Despesas não identificadas" num grupo excluído é
       * pendência disfarçada de decisão.
       */
      nome: "exclusoes_do_resultado",
      sql: `
        SELECT g.id AS grupo_id, g.nome AS grupo_nome, m.observacao,
               count(DISTINCT c.id)                        AS contas,
               count(tr.id)                                AS transacoes,
               round(coalesce(sum(tr.valor), 0), 2)        AS valor_transacoes
          FROM public.dre_mapeamento m
          JOIN public.planosdecontagrupos g ON g.id = m.origem_id
          LEFT JOIN public.planosdeconta c ON c.grupo_id = g.id
          LEFT JOIN public.transacao tr
            ON tr.plano_de_conta_id = c.id
           AND tr.competencia_em BETWEEN $1::timestamptz AND $2::timestamptz
         WHERE m.ativo AND m.origem_tipo = 'PLANO_GRUPO' AND m.exclui_do_resultado
         GROUP BY 1, 2, 3
         ORDER BY valor_transacoes DESC`,
      params: [janela.de, janela.ate],
    },
    {
      /*
       * Transação elegível que não gerou evento. A seção 6.3 exige conferir
       * isto: ausência de evento não é ausência de fato.
       */
      nome: "transacoes_sem_evento",
      sql: `
        SELECT to_char(tr.competencia_em, 'YYYY-MM') AS competencia,
               tr.tipo::text AS tipo, coalesce(c.nome, '(sem conta)') AS conta_nome,
               count(*) AS transacoes, round(sum(tr.valor), 2) AS valor
          FROM public.transacao tr
          LEFT JOIN public.planosdeconta c ON c.id = tr.plano_de_conta_id
         WHERE tr.competencia_em BETWEEN $1::timestamptz AND $2::timestamptz
           AND NOT EXISTS (
             SELECT 1 FROM public.eventos_financeiros e
              WHERE e.source_type = 'TRANSACAO' AND e.source_id = tr.id
                AND e.status IN ('ATIVO', 'CONVERTIDO')
           )
         GROUP BY 1, 2, 3
         ORDER BY valor DESC NULLS LAST`,
      params: [janela.de, janela.ate],
    },
    {
      /* Colisões que a migração do catálogo precisa respeitar. */
      nome: "colisoes_codigo_conta",
      sql: `
        SELECT upper(btrim(coalesce(codigo, ''))) AS codigo, count(*) AS contas,
               array_agg(id ORDER BY id) AS ids
          FROM public.planosdeconta
         WHERE nullif(btrim(codigo), '') IS NOT NULL
         GROUP BY 1 HAVING count(*) > 1
         ORDER BY 2 DESC`,
    },
    {
      nome: "tipos_ajuste_transacao",
      sql: `
        SELECT a.id, a.codigo, a.codigo_sistema, a.nome, a.natureza, a.ativo,
               (SELECT count(*) FROM public.transacao_ajuste ta WHERE ta.tipo_id = a.id) AS usos,
               (SELECT round(coalesce(sum(ta.valor_calculado), 0), 2)
                  FROM public.transacao_ajuste ta WHERE ta.tipo_id = a.id) AS valor
          FROM public.tipos_ajuste_transacao a
         ORDER BY usos DESC, a.id`,
    },
    {
      /*
       * Assinatura das funções de classificação. Se divergir entre bancos, a
       * comparação de DRE deixa de ser comparação de cadastro.
       */
      nome: "funcoes_classificacao",
      sql: `
        SELECT p.proname,
               md5(pg_get_functiondef(p.oid)) AS definicao_md5,
               pg_get_function_identity_arguments(p.oid) AS argumentos
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'dre_somar_por_linha', 'dre_lancamentos_por_linha',
             'dre_linha_da_transacao', 'sincronizar_eventos_financeiros_transacao',
             'propagar_nome_plano_de_conta', 'sincronizar_plano_de_conta_transacao'
           )
         ORDER BY 1, 3`,
    },
    {
      nome: "migracoes_aplicadas",
      sql: `
        SELECT version, name
          FROM supabase_migrations.schema_migrations
         ORDER BY version DESC
         LIMIT 8`,
    },
    {
      /* Estruturas novas do plano ainda não existem: confirma que nada foi aplicado. */
      nome: "estruturas_novas_presentes",
      sql: `
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname IN (
             'classificacoes_resultado', 'plano_contas_classificacao_regra',
             'eventos_financeiros_classificacao', 'dre_implantacao'
           )
         ORDER BY 1`,
    },
  ];
}

async function inventariar(config: DatabaseConfig, janela: { de: string; ate: string }) {
  const { client } = await connectDatabase(config);
  const resultado: Record<string, unknown> = {
    banco: config.key,
    label: config.label,
    janela,
    geradoEm: new Date().toISOString(),
  };

  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");

    for (const consulta of consultas(janela)) {
      try {
        const { rows } = await client.query(consulta.sql, consulta.params as never);
        resultado[consulta.nome] = rows;
      } catch (error) {
        /*
         * Uma consulta que falha não pode virar lista vazia: o relatório
         * precisa dizer que aquele recorte é desconhecido, não que está limpo.
         * O ROLLBACK devolve a transação ao estado utilizável.
         */
        const mensagem = error instanceof Error ? error.message : String(error);
        resultado[consulta.nome] = { erro: mensagem };
        await client.query("ROLLBACK");
        await client.query("BEGIN");
        await client.query("SET TRANSACTION READ ONLY");
      }
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }

  return resultado;
}

function numero(valor: unknown) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function moeda(valor: unknown) {
  return numero(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function linhas(dados: Record<string, unknown>, chave: string) {
  const valor = dados[chave];
  return Array.isArray(valor) ? (valor as Record<string, unknown>[]) : [];
}

function erro(dados: Record<string, unknown>, chave: string) {
  const valor = dados[chave];
  return valor && !Array.isArray(valor) && typeof valor === "object" && "erro" in valor
    ? String((valor as { erro: unknown }).erro)
    : null;
}

function resumoMarkdown(inventarios: Record<string, unknown>[], janela: { de: string; ate: string }) {
  const partes: string[] = [];
  partes.push("# Inventário do plano de contas e da classificação da DRE\n");
  partes.push(`Gerado em ${new Date().toISOString()}. Janela: ${janela.de.slice(0, 10)} a ${janela.ate.slice(0, 10)} (UTC, mesmo critério da API atual).\n`);
  partes.push("Consultas somente leitura. Nenhum cadastro, lançamento ou função foi alterado.\n");

  partes.push("\n## Cadastro\n");
  partes.push("| Banco | Grupos (ativos) | Contas (ativas) | Mapeamentos ativos | Grupos sem destino |");
  partes.push("|---|---:|---:|---:|---:|");
  for (const inv of inventarios) {
    const resumo = linhas(inv, "resumo_cadastro")[0] ?? {};
    const grupos = linhas(inv, "grupos");
    const semDestino = grupos.filter((g) => g.ativo && numero(g.mapeamentos) === 0).length;
    partes.push(
      `| ${inv.label} | ${numero(resumo.grupos)} (${numero(resumo.grupos_ativos)}) | ${numero(resumo.contas)} (${numero(resumo.contas_ativas)}) | ${numero(resumo.mapeamentos_ativos)} | ${semDestino} |`,
    );
  }

  partes.push("\n## Cobertura da classificação na janela\n");
  partes.push("| Banco | Eventos sem destino | Valor sem destino | Natureza incompatível | Valor incompatível | Transações sem evento |");
  partes.push("|---|---:|---:|---:|---:|---:|");
  for (const inv of inventarios) {
    const semLinha = linhas(inv, "eventos_sem_linha");
    const incompativel = linhas(inv, "natureza_incompativel");
    const semEvento = linhas(inv, "transacoes_sem_evento");
    const soma = (rows: Record<string, unknown>[], campo: string) =>
      rows.reduce((total, row) => total + numero(row[campo]), 0);
    partes.push(
      `| ${inv.label} | ${soma(semLinha, "lancamentos")} | ${moeda(soma(semLinha, "valor"))} | ${soma(incompativel, "lancamentos")} | ${moeda(soma(incompativel, "valor"))} | ${soma(semEvento, "transacoes")} |`,
    );
  }

  partes.push("\n## Grupos ativos sem destino na DRE\n");
  for (const inv of inventarios) {
    const grupos = linhas(inv, "grupos").filter((g) => g.ativo && numero(g.mapeamentos) === 0);
    partes.push(`\n### ${inv.label}\n`);
    if (erro(inv, "grupos")) {
      partes.push(`Consulta indisponível: ${erro(inv, "grupos")}`);
      continue;
    }
    if (!grupos.length) {
      partes.push("Nenhum.");
      continue;
    }
    partes.push("| Código | Grupo | Contas ativas | Transações |");
    partes.push("|---|---|---:|---:|");
    for (const g of grupos) {
      partes.push(`| ${g.codigo ?? ""} | ${g.nome} | ${numero(g.contas_ativas)} | ${numero(g.transacoes)} |`);
    }
  }

  partes.push("\n## Exclusões do resultado a revisar\n");
  for (const inv of inventarios) {
    const exclusoes = linhas(inv, "exclusoes_do_resultado");
    partes.push(`\n### ${inv.label}\n`);
    if (!exclusoes.length) {
      partes.push("Nenhuma exclusão ativa por grupo.");
      continue;
    }
    partes.push("| Grupo | Contas | Transações na janela | Valor |");
    partes.push("|---|---:|---:|---:|");
    for (const e of exclusoes) {
      partes.push(`| ${e.grupo_nome} | ${numero(e.contas)} | ${numero(e.transacoes)} | ${moeda(e.valor_transacoes)} |`);
    }
  }

  partes.push("\n## Mapeamentos por tipo de origem\n");
  partes.push("O sincronizador de avulsos lê apenas `PLANO_GRUPO`. Linhas de outro tipo estão cadastradas e não são aplicadas.\n");
  partes.push("| Banco | Tipo | Ativo | Total | Exclusões | Com rateio | Com vigência |");
  partes.push("|---|---|---|---:|---:|---:|---:|");
  for (const inv of inventarios) {
    for (const m of linhas(inv, "mapeamentos_por_tipo")) {
      partes.push(
        `| ${inv.label} | ${m.origem_tipo} | ${m.ativo ? "sim" : "não"} | ${numero(m.total)} | ${numero(m.exclusoes)} | ${numero(m.com_rateio)} | ${numero(m.com_vigencia)} |`,
      );
    }
  }

  partes.push("\n## Integridade dos mapeamentos\n");
  partes.push("| Banco | Órfãos | Origens com mais de um destino ativo |");
  partes.push("|---|---:|---:|");
  for (const inv of inventarios) {
    partes.push(
      `| ${inv.label} | ${linhas(inv, "mapeamentos_orfaos").length} | ${linhas(inv, "mapeamentos_conflitantes").length} |`,
    );
  }

  partes.push("\n## Funções de classificação\n");
  partes.push("Hashes iguais entre bancos significam que a divergência de DRE é de cadastro, não de código.\n");
  const funcoes = new Set<string>();
  for (const inv of inventarios) {
    for (const f of linhas(inv, "funcoes_classificacao")) funcoes.add(String(f.proname));
  }
  partes.push(`| Função | ${inventarios.map((i) => i.label).join(" | ")} |`);
  partes.push(`|---|${inventarios.map(() => "---").join("|")}|`);
  for (const nome of [...funcoes].sort()) {
    const celulas = inventarios.map((inv) => {
      const encontrada = linhas(inv, "funcoes_classificacao").find((f) => f.proname === nome);
      return encontrada ? String(encontrada.definicao_md5).slice(0, 8) : "ausente";
    });
    partes.push(`| ${nome} | ${celulas.join(" | ")} |`);
  }

  partes.push("\n## Estruturas do plano novo\n");
  for (const inv of inventarios) {
    const presentes = linhas(inv, "estruturas_novas_presentes").map((r) => r.relname);
    partes.push(`- ${inv.label}: ${presentes.length ? presentes.join(", ") : "nenhuma (esperado antes da Fase 1)"}`);
  }

  partes.push("\n## Últimas migrations aplicadas\n");
  for (const inv of inventarios) {
    const versoes = linhas(inv, "migracoes_aplicadas").map((r) => r.version);
    partes.push(`- ${inv.label}: ${versoes.slice(0, 3).join(", ")}`);
  }

  const falhas: string[] = [];
  for (const inv of inventarios) {
    for (const chave of Object.keys(inv)) {
      const mensagem = erro(inv, chave);
      if (mensagem) falhas.push(`- ${inv.label} / ${chave}: ${mensagem}`);
    }
  }
  partes.push("\n## Consultas que falharam\n");
  partes.push(falhas.length ? falhas.join("\n") : "Nenhuma.");

  return `${partes.join("\n")}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const indiceMeses = args.indexOf("--meses");
  const meses = indiceMeses >= 0 ? Number(args[indiceMeses + 1]) : 13;
  const chaves = args.filter((a) => CHAVES_VALIDAS.includes(a as DatabaseKey)) as DatabaseKey[];

  if (!Number.isFinite(meses) || meses < 1 || meses > 60) {
    throw new Error("--meses deve estar entre 1 e 60.");
  }

  const janela = janelaDeMeses(meses);
  const configs = loadDatabaseConfigs().filter(
    (c) => !chaves.length || chaves.includes(c.key),
  );

  const destino = path.join(projectRoot, "artifacts", "captures", "dre-plano-contas");
  fs.mkdirSync(destino, { recursive: true });

  const inventarios: Record<string, unknown>[] = [];
  for (const config of configs) {
    process.stdout.write(`Inventariando ${config.label}... `);
    const inventario = await inventariar(config, janela);
    inventarios.push(inventario);
    fs.writeFileSync(
      path.join(destino, `inventario-${config.key}.json`),
      `${JSON.stringify(inventario, null, 2)}\n`,
      "utf8",
    );
    console.log("ok");
  }

  const markdown = resumoMarkdown(inventarios, janela);
  const arquivoResumo = path.join(destino, "resumo.md");
  fs.writeFileSync(arquivoResumo, markdown, "utf8");

  const hash = crypto.createHash("sha256").update(JSON.stringify(inventarios)).digest("hex");
  fs.writeFileSync(
    path.join(destino, "inventario.hash"),
    `${hash}  ${new Date().toISOString()}  meses=${meses}\n`,
    "utf8",
  );

  console.log(`\nResumo: ${path.relative(projectRoot, arquivoResumo)}`);
  console.log(`Hash do inventário: ${hash.slice(0, 16)}`);
  console.log(markdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
