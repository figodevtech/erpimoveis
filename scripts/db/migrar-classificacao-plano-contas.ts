/**
 * Fase 4: migração da classificação dos cadastros existentes.
 *
 * Uso:
 *   npm run db:migrar:plano-contas -- demo                    # simula e grava o lote
 *   npm run db:migrar:plano-contas -- demo --aplicar          # aplica o lote
 *   npm run db:migrar:plano-contas -- demo --instalar-padrao  # instala o catálogo base
 *
 * Sem `--aplicar` nada é escrito além do próprio lote, que é a proposta em
 * papel. A aplicação é uma decisão separada, e cada unidade só entra se o
 * cadastro não tiver mudado desde a simulação.
 *
 * Só entram no lote as propostas de certeza ALTA. MÉDIA e BAIXA aparecem no
 * relatório para decisão humana: nome é indício, não identidade — foi por uma
 * regra de palavra-chave que IRPJ e CSLL foram parar em dedução da receita.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  CONTAS_PADRAO,
  GRUPOS_PADRAO,
  classificacaoEfetiva,
} from "../../src/lib/financeiro/plano-contas/catalogo";
import {
  sugerirClassificacaoConta,
  sugerirClassificacaoGrupo,
  type Certeza,
} from "../../src/lib/financeiro/plano-contas/sugestao";
import { connectDatabase, loadDatabaseConfigs, projectRoot, type DatabaseKey } from "./lib";

const BANCOS: DatabaseKey[] = ["demo", "demir", "alpha", "garage"];

type Proposta = {
  entidade: "GRUPO" | "CONTA";
  entidadeId: number;
  nome: string;
  grupo: string;
  versao: number;
  classificacao: string | null;
  certeza: Certeza;
  justificativa: string;
  destinoAtual: string;
  transacoes: number;
};

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR");
}

/** O catálogo do repositório, no formato que a RPC de instalação espera. */
function definicaoDoCatalogo() {
  return {
    grupos: GRUPOS_PADRAO.map((g) => ({
      codigo: g.codigo,
      nome: g.nome,
      codigo_sugerido: g.codigoSugerido,
      classificacao: g.classificacao,
    })),
    contas: CONTAS_PADRAO.map((c) => ({
      codigo: c.codigo,
      nome: c.nome,
      grupo: c.grupo,
      instalacao: c.instalacao,
      classificacao: c.classificacao ?? classificacaoEfetiva(c),
    })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const chave = (args.find((a) => (BANCOS as readonly string[]).includes(a)) ?? "demo") as DatabaseKey;
  const aplicar = args.includes("--aplicar");
  const instalarPadrao = args.includes("--instalar-padrao");
  const vigencia = args.includes("--vigencia")
    ? args[args.indexOf("--vigencia") + 1]
    : new Date().toISOString().slice(0, 8) + "01";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigencia)) {
    throw new Error(`Vigência inválida: ${vigencia}. Use AAAA-MM-DD.`);
  }

  const banco = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!banco) throw new Error(`Banco ${chave} não configurado.`);

  const { client } = await connectDatabase(banco);
  let ecoarNotices = true;
  client.on("notice", (n) => {
    if (ecoarNotices && n.message) console.log(`  ${n.message}`);
  });

  try {
    console.log(`Migração da classificação em ${banco.label} (vigência ${vigencia}).\n`);

    if (instalarPadrao) {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM public.plano_contas_instalar_padrao($1::jsonb, $2::date, true, NULL)",
        [JSON.stringify(definicaoDoCatalogo()), vigencia],
      );
      await client.query("COMMIT");
      const porAcao = new Map<string, number>();
      for (const linha of rows) porAcao.set(linha.acao, (porAcao.get(linha.acao) ?? 0) + 1);
      console.log("Instalação do catálogo padrão:");
      for (const [acao, total] of porAcao) console.log(`  ${acao.padEnd(14)} ${total}`);
      for (const linha of rows.filter((r) => r.acao.startsWith("COLISAO") || r.acao === "SEM_GRUPO")) {
        console.log(`  ! ${linha.codigo_sistema}: ${linha.detalhe}`);
      }
      console.log();
    }

    // Leitura da situação atual. Read-only de propósito: a proposta é montada
    // sobre o que existe hoje, e a versão lida aqui é a que a aplicação exige.
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    const legado = `
      LEFT JOIN LATERAL (
        SELECT CASE WHEN m.exclui_do_resultado THEN 'FORA DA DRE' ELSE l.codigo END AS destino
          FROM public.dre_mapeamento m
          LEFT JOIN public.dre_linha l ON l.id = m.linha_id
         WHERE m.ativo AND m.origem_tipo = 'PLANO_GRUPO' AND m.origem_id = %GRUPO%
         LIMIT 1) legado ON true`;

    const grupos = await client.query(`
      SELECT g.id, g.nome, g.versao_registro, g.origem_cadastro, g.classificacao_padrao_id,
             coalesce(v.situacao, 'PENDENTE') AS situacao,
             coalesce(v.linha_codigo, legado.destino, '—') AS destino,
             (SELECT count(*) FROM public.planosdeconta c
               JOIN public.transacao t ON t.plano_de_conta_id = c.id
              WHERE c.grupo_id = g.id) AS transacoes
        FROM public.planosdecontagrupos g
        LEFT JOIN public.plano_contas_grupos_visao() v ON v.grupo_id = g.id
        ${legado.replace("%GRUPO%", "g.id")}
       ORDER BY g.codigo`);

    const contas = await client.query(`
      SELECT v.conta_id AS id, v.conta_nome AS nome, v.grupo_nome AS grupo,
             v.conta_versao AS versao_registro, v.conta_origem AS origem_cadastro,
             v.classificacao_especifica, v.situacao,
             coalesce(v.linha_codigo, legado.destino, '—') AS destino, v.transacoes
        FROM public.plano_contas_visao() v
        ${legado.replace("%GRUPO%", "v.grupo_id")}`);
    const catalogo = await client.query("SELECT id, codigo FROM public.classificacoes_resultado");
    await client.query("ROLLBACK");

    const idPorCodigo = new Map<string, number>(catalogo.rows.map((r) => [r.codigo, Number(r.id)]));

    const propostas: Proposta[] = [];

    for (const g of grupos.rows) {
      // Cadastro do sistema já nasce classificado; propor de novo seria mexer
      // no que o catálogo definiu.
      if (g.origem_cadastro === "SISTEMA" || g.classificacao_padrao_id) continue;
      const sugestao = sugerirClassificacaoGrupo(g.nome);
      propostas.push({
        entidade: "GRUPO",
        entidadeId: Number(g.id),
        nome: g.nome,
        grupo: g.nome,
        versao: Number(g.versao_registro),
        classificacao: sugestao.classificacao,
        certeza: sugestao.certeza,
        justificativa: sugestao.justificativa,
        destinoAtual: String(g.destino),
        transacoes: Number(g.transacoes ?? 0),
      });
    }

    for (const c of contas.rows) {
      if (c.origem_cadastro === "SISTEMA" || c.classificacao_especifica) continue;
      const sugestao = sugerirClassificacaoConta({ contaNome: c.nome, grupoNome: c.grupo });
      propostas.push({
        entidade: "CONTA",
        entidadeId: Number(c.id),
        nome: c.nome,
        grupo: c.grupo,
        versao: Number(c.versao_registro),
        classificacao: sugestao.classificacao,
        certeza: sugestao.certeza,
        justificativa: sugestao.justificativa,
        destinoAtual: String(c.destino),
        transacoes: Number(c.transacoes ?? 0),
      });
    }

    const aplicaveis = propostas.filter((p) => p.certeza === "ALTA" && p.classificacao);
    const revisar = propostas.filter((p) => !(p.certeza === "ALTA" && p.classificacao));

    console.log(`Cadastros analisados: ${propostas.length}`);
    console.log(`  certeza alta (entram no lote): ${aplicaveis.length}`);
    console.log(`  precisam de decisão:           ${revisar.length}`);
    const comUso = revisar.filter((p) => p.transacoes > 0);
    console.log(`  dessas, já com lançamentos:    ${comUso.length}\n`);

    if (comUso.length) {
      console.log("Precisam de decisão e já têm lançamentos:");
      for (const p of comUso.sort((a, b) => b.transacoes - a.transacoes).slice(0, 20)) {
        console.log(
          `  ${String(p.transacoes).padStart(4)} lanç. | hoje ${p.destinoAtual.padEnd(6)} | ${p.grupo} / ${p.nome}`,
        );
        console.log(`         ${p.justificativa}`);
      }
      console.log();
    }

    // Referência estável: a mesma proposta não cria um lote novo a cada
    // execução, e uma proposta diferente não sobrescreve a anterior.
    const impressao = crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          aplicaveis.map((p) => [p.entidade, p.entidadeId, p.classificacao, p.versao]).sort(),
        ) + vigencia,
      )
      .digest("hex")
      .slice(0, 16);
    const referencia = `migracao-${vigencia}-${impressao}`;

    const destino = path.join(projectRoot, "artifacts", "captures", "dre-plano-contas");
    fs.mkdirSync(destino, { recursive: true });
    fs.writeFileSync(
      path.join(destino, `migracao-${chave}.json`),
      `${JSON.stringify({ banco: chave, referencia, vigencia, propostas }, null, 2)}\n`,
      "utf8",
    );

    if (!aplicaveis.length) {
      console.log("Nenhuma proposta de certeza alta: não há lote a criar.");
      return;
    }

    await client.query("BEGIN");
    const lote = await client.query(
      `INSERT INTO public.plano_contas_lote (referencia, vigencia_inicio, versao_catalogo, observacao)
       VALUES ($1, $2::date, (SELECT max(versao_catalogo) FROM public.classificacoes_resultado), $3)
       ON CONFLICT (referencia) DO UPDATE SET observacao = excluded.observacao
       RETURNING id, estado`,
      [referencia, vigencia, `Migração automática. ${aplicaveis.length} unidade(s) de certeza alta.`],
    );
    const loteId = Number(lote.rows[0].id);

    for (const p of aplicaveis) {
      await client.query(
        `INSERT INTO public.plano_contas_lote_item
           (lote_id, entidade, entidade_id, classificacao_id, versao_esperada, certeza,
            justificativa, destino_atual, destino_proposto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (lote_id, entidade, entidade_id) DO NOTHING`,
        [
          loteId,
          p.entidade,
          p.entidadeId,
          idPorCodigo.get(p.classificacao as string) ?? null,
          p.versao,
          p.certeza,
          p.justificativa,
          p.destinoAtual,
          p.classificacao,
        ],
      );
    }
    await client.query("COMMIT");

    console.log(`Lote ${loteId} (${referencia}) com ${aplicaveis.length} unidade(s), estado ${lote.rows[0].estado}.`);

    if (!aplicar) {
      console.log("\nSimulação apenas. Rode de novo com --aplicar para gravar a classificação.");
      return;
    }

    await client.query("BEGIN");
    const resultado = await client.query(
      "SELECT * FROM public.plano_contas_aplicar_lote($1, NULL, 2000)",
      [loteId],
    );
    await client.query("COMMIT");

    const { aplicados, conflitos, erros, restantes } = resultado.rows[0];
    console.log(
      `\nAplicado: ${aplicados} · conflitos: ${conflitos} · erros: ${erros} · restantes: ${restantes}`,
    );

    if (Number(erros) > 0 || Number(conflitos) > 0) {
      const detalhe = await client.query(
        `SELECT entidade, entidade_id, estado, motivo
           FROM public.plano_contas_lote_item
          WHERE lote_id = $1 AND estado IN ('CONFLITO', 'ERRO')
          ORDER BY id LIMIT 30`,
        [loteId],
      );
      console.log("\nUnidades não aplicadas:");
      for (const linha of detalhe.rows) {
        console.log(`  ${linha.entidade} ${linha.entidade_id} [${linha.estado}] ${linha.motivo ?? ""}`);
      }
    }

    if (Number(restantes) > 0) {
      console.log(`\nAinda restam ${moeda(Number(restantes))} unidade(s): rode de novo para continuar.`);
    }
  } finally {
    ecoarNotices = false;
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
