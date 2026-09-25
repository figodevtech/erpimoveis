/**
 * Catálogo DIFAL: diff por banco ou global, sem exclusão de regras locais.
 * npm run fiscal:difal -- --todos [--aplicar]
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import type { Client } from "pg";
import { connectDatabase, loadDatabaseConfigs, projectRoot, type DatabaseConfig } from "../db/lib";
import type { RegraDifal } from "../../src/lib/nfe/difalRegras";
import { resolverRegraDifalComRegras } from "../../src/services/fiscal/difal/resolverRegraDifal";

type Regra = {
  uf: string; tipoRegra: string; descricao: string; ncm?: string | null;
  ncmPrefixo?: string | null; cest?: string | null;
  aliquotaIcmsInterna: number | null; aliquotaFcp: number | null;
  reducaoBase?: number | null; vigenciaInicio: string; vigenciaFim: string | null;
  fonte?: string; fonteUrl?: string; fundamentoLegal?: string | null;
  dataFonte?: string | null; ativo?: boolean; notaCuradoria?: string | null;
};
type Catalogo = { fonte: string; fonteUrl: string; capturadoEm: string; regras: Regra[] };
type Linha = {
  id: number; uf: string; tipo_regra: string; descricao: string;
  ncm: string | null; ncm_prefixo: string | null; cest: string | null;
  aliquota_icms_interna: string | null; aliquota_fcp: string | null;
  reducao_base: string | null; vigencia_inicio: string; vigencia_fim: string | null;
  prioridade: number; fonte: string; fonte_url: string | null;
  fundamento_legal: string | null; data_fonte: string | null;
  ativo: boolean; nota_curadoria: string | null;
};
type Plano = {
  db: DatabaseConfig; client: Client; novas: Regra[];
  alteradas: Array<{ regra: Regra; linha: Linha; campos: string[] }>;
  iguais: number; locais: number;
};
const PRIORIDADE: Record<string, number> = {
  GERAL: 10, NCM_PREFIXO: 20, NCM: 30, CEST: 40,
  NCM_CEST: 50, BENEFICIO: 60, EXCECAO: 70,
};
const key = (r: {
  uf: string; tipo_regra?: string; tipoRegra?: string; ncm?: string | null;
  ncm_prefixo?: string | null; ncmPrefixo?: string | null; cest?: string | null;
  vigencia_inicio?: string; vigenciaInicio?: string;
}) => [
  r.uf, r.tipo_regra ?? r.tipoRegra, r.ncm ?? "", r.ncm_prefixo ?? r.ncmPrefixo ?? "",
  r.cest ?? "", String(r.vigencia_inicio ?? r.vigenciaInicio ?? "").slice(0, 10),
].join("|");
const numero = (v: unknown) => v === null || v === undefined || v === "" ? null : Number(v);
const igualNumero = (a: unknown, b: number | null) => {
  const x = numero(a);
  return x === null || b === null ? x === b : Math.abs(x - b) < 1e-9;
};
const origem = (r: Regra, c: Catalogo) => ({
  fonte: r.fonte ?? c.fonte, fonteUrl: r.fonteUrl ?? c.fonteUrl,
});

function diff(linha: Linha, r: Regra, c: Catalogo): string[] {
  const campos: string[] = [];
  if (!igualNumero(linha.aliquota_icms_interna, r.aliquotaIcmsInterna)) campos.push("aliquota_icms_interna");
  if (!igualNumero(linha.aliquota_fcp, r.aliquotaFcp)) campos.push("aliquota_fcp");
  if (!igualNumero(linha.reducao_base, r.reducaoBase ?? null)) campos.push("reducao_base");
  const pares: Array<[string, unknown, unknown]> = [
    ["descricao", linha.descricao, r.descricao],
    ["vigencia_fim", linha.vigencia_fim, r.vigenciaFim],
    ["prioridade", linha.prioridade, PRIORIDADE[r.tipoRegra] ?? 10],
    ["fonte", linha.fonte, origem(r, c).fonte],
    ["fonte_url", linha.fonte_url, origem(r, c).fonteUrl],
    ["fundamento_legal", linha.fundamento_legal, r.fundamentoLegal ?? null],
    ["data_fonte", linha.data_fonte, r.dataFonte ?? null],
    ["ativo", linha.ativo, r.ativo ?? true],
    ["nota_curadoria", linha.nota_curadoria, r.notaCuradoria ?? null],
  ];
  for (const [nome, antes, depois] of pares) if (antes !== depois) campos.push(nome);
  return campos;
}

async function planejar(db: DatabaseConfig, catalogo: Catalogo): Promise<Plano> {
  const { client } = await connectDatabase(db);
  try {
    const tabela = await client.query<{ existe: string | null }>(
      "SELECT to_regclass('public.fiscal_difal_regra')::text AS existe",
    );
    if (!tabela.rows[0]?.existe) throw new Error("public.fiscal_difal_regra não existe");
    const { rows } = await client.query<Linha>(
      `SELECT id, uf, tipo_regra, descricao, ncm, ncm_prefixo, cest,
              aliquota_icms_interna::text, aliquota_fcp::text, reducao_base::text,
              vigencia_inicio::text, vigencia_fim::text, prioridade, fonte, fonte_url,
              fundamento_legal, data_fonte::text, ativo, nota_curadoria
         FROM public.fiscal_difal_regra`,
    );
    const existentes = new Map<string, Linha>();
    for (const linha of rows) {
      const chave = key(linha);
      if (existentes.has(chave)) throw new Error(`chave lógica duplicada: ${chave}`);
      existentes.set(chave, linha);
    }
    const novas: Regra[] = [];
    const alteradas: Plano["alteradas"] = [];
    let iguais = 0;
    for (const regra of catalogo.regras) {
      const linha = existentes.get(key(regra));
      if (!linha) novas.push(regra);
      else {
        const campos = diff(linha, regra, catalogo);
        if (campos.length) alteradas.push({ regra, linha, campos });
        else iguais++;
      }
    }
    const chavesCuradas = new Set(catalogo.regras.map(key));
    return { db, client, novas, alteradas, iguais,
      locais: rows.filter((r) => !chavesCuradas.has(key(r))).length };
  } catch (erro) {
    await client.end().catch(() => undefined);
    throw erro;
  }
}

function mostrar(plano: Plano) {
  console.log(`\n${plano.db.label} [${plano.db.key}]: iguais=${plano.iguais}, inserir=${plano.novas.length}, alterar=${plano.alteradas.length}, locais preservadas=${plano.locais}`);
  for (const r of plano.novas)
    console.log(`  + ${key(r)} interna=${r.aliquotaIcmsInterna} FCP=${r.aliquotaFcp} fim=${r.vigenciaFim ?? "atual"}`);
  for (const { regra, linha, campos } of plano.alteradas)
    console.log(`  ~ #${linha.id} ${key(regra)}: ${campos.join(", ")}`);
}

async function aplicar(plano: Plano, catalogo: Catalogo) {
  if (!plano.novas.length && !plano.alteradas.length) return;
  const { client } = plano;
  await client.query("BEGIN");
  try {
    for (const r of plano.novas) {
      const fonte = origem(r, catalogo);
      const result = await client.query(
        `INSERT INTO public.fiscal_difal_regra (
           uf, tipo_regra, descricao, ncm, ncm_prefixo, cest, aliquota_icms_interna,
           aliquota_fcp, reducao_base, vigencia_inicio, vigencia_fim, prioridade,
           fonte, fonte_url, fundamento_legal, data_fonte, ativo, nota_curadoria, importado_em
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT DO NOTHING`,
        [r.uf, r.tipoRegra, r.descricao, r.ncm ?? null, r.ncmPrefixo ?? null,
          r.cest ?? null, r.aliquotaIcmsInterna, r.aliquotaFcp, r.reducaoBase ?? null,
          r.vigenciaInicio, r.vigenciaFim, PRIORIDADE[r.tipoRegra] ?? 10,
          fonte.fonte, fonte.fonteUrl, r.fundamentoLegal ?? null, r.dataFonte ?? null,
          r.ativo ?? true, r.notaCuradoria ?? null, catalogo.capturadoEm],
      );
      if (result.rowCount !== 1) throw new Error(`inserção não aplicada: ${key(r)}`);
    }
    for (const { regra: r, linha } of plano.alteradas) {
      const fonte = origem(r, catalogo);
      const result = await client.query(
        `UPDATE public.fiscal_difal_regra SET
           descricao=$2, aliquota_icms_interna=$3, aliquota_fcp=$4,
           reducao_base=$5, vigencia_fim=$6, prioridade=$7, fonte=$8,
           fonte_url=$9, fundamento_legal=$10, data_fonte=$11, ativo=$12,
           nota_curadoria=$13, importado_em=$14 WHERE id=$1`,
        [linha.id, r.descricao, r.aliquotaIcmsInterna, r.aliquotaFcp,
          r.reducaoBase ?? null, r.vigenciaFim, PRIORIDADE[r.tipoRegra] ?? 10,
          fonte.fonte, fonte.fonteUrl, r.fundamentoLegal ?? null, r.dataFonte ?? null,
          r.ativo ?? true, r.notaCuradoria ?? null, catalogo.capturadoEm],
      );
      if (result.rowCount !== 1) throw new Error(`atualização não aplicada: #${linha.id}`);
    }
    await client.query("COMMIT");
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  }
}

async function verificarAl(plano: Plano) {
  const { rows } = await plano.client.query<Linha>(
    `SELECT id, uf, tipo_regra, descricao, ncm, ncm_prefixo, cest,
            aliquota_icms_interna::text, aliquota_fcp::text, reducao_base::text,
            vigencia_inicio::text, vigencia_fim::text, prioridade, fonte, fonte_url,
            fundamento_legal, data_fonte::text, ativo, nota_curadoria
       FROM public.fiscal_difal_regra
      WHERE uf='AL' ORDER BY vigencia_inicio, id`,
  );
  const gerais = rows.filter((r) => r.tipo_regra === "GERAL");
  assert.deepEqual(gerais.map((r) => [
    r.vigencia_inicio, r.vigencia_fim, numero(r.aliquota_icms_interna),
    numero(r.aliquota_fcp), r.ativo,
  ]), [
    ["2023-04-01", "2026-03-31", 19, 1, true],
    ["2026-04-01", null, 20.5, 1, true],
  ], `AL GERAL divergente em ${plano.db.label}`);
  console.log(`  SQL AL GERAL em ${plano.db.label}: 2023-04-01..2026-03-31=19+1; 2026-04-01..atual=20.5+1`);

  const regras: RegraDifal[] = rows.map((r) => ({
    id: r.id, uf: r.uf, tipoRegra: r.tipo_regra as RegraDifal["tipoRegra"],
    descricao: r.descricao, ncm: r.ncm, ncmPrefixo: r.ncm_prefixo, cest: r.cest,
    aliquotaIcmsInterna: numero(r.aliquota_icms_interna),
    aliquotaFcp: numero(r.aliquota_fcp), reducaoBase: numero(r.reducao_base),
    vigenciaInicio: r.vigencia_inicio, vigenciaFim: r.vigencia_fim,
    prioridade: r.prioridade, fonte: r.fonte, fonteUrl: r.fonte_url,
    fundamentoLegal: r.fundamento_legal, dataFonte: r.data_fonte, ativo: r.ativo,
  }));
  for (const ncm of ["84212300", "84099969", "90259090", "85365090"]) {
    const saida = resolverRegraDifalComRegras({
      ufEmitente: "PB", ufDestino: "AL", dataEmissao: "2026-09-25",
      modelo: 55, crt: 3, indFinal: 1, indIEDest: 9, tpNF: 1,
      ncm, origemMercadoria: "0", cfop: "6108", cst: "00",
    }, regras);
    assert.match(saida.origemAliquotaInterna, /^REGRA_/);
    assert.match(saida.origemFcp, /^REGRA_/);
    if (saida.origemAliquotaInterna === "REGRA_UF")
      assert.equal(saida.aliquotaInterna, 20.5, `${plano.db.label} NCM ${ncm} interna geral`);
    if (saida.origemFcp === "REGRA_UF")
      assert.equal(saida.aliquotaFcp, 1, `${plano.db.label} NCM ${ncm} FCP geral`);
    assert.deepEqual(saida.pendencias, [], `${plano.db.label} NCM ${ncm} pendências`);
    console.log(`  resolver ${ncm}: interna=${saida.aliquotaInterna} FCP=${saida.aliquotaFcp} origem=${saida.origemAliquotaInterna}/${saida.origemFcp}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const todos = args.includes("--todos");
  const escrever = args.includes("--aplicar");
  const bancos = args.filter((a) => !a.startsWith("--"));
  if (args.some((a) => a.startsWith("--") && a !== "--todos" && a !== "--aplicar")
    || bancos.length > 1 || (todos && bancos.length))
    throw new Error("Uso: fiscal:difal -- <banco>|--todos [--aplicar]");
  const configs = loadDatabaseConfigs();
  const selecionados = todos ? configs : configs.filter((d) => d.key === (bancos[0] ?? "demo"));
  if (!selecionados.length)
    throw new Error(`Banco inválido. Configurados: ${configs.map((d) => d.key).join(", ")}`);
  const catalogo = JSON.parse(fs.readFileSync(path.join(
    projectRoot, "data", "fiscal", "difal", "aliquotas-uf.json",
  ), "utf8")) as Catalogo;
  const chaves = catalogo.regras.map(key);
  if (new Set(chaves).size !== chaves.length) throw new Error("Chave lógica duplicada no catálogo.");
  console.log(`Catálogo: ${catalogo.regras.length} regras. Bancos: ${selecionados.map((d) => d.label).join(", ")}`);

  const planos: Plano[] = [];
  try {
    // Em --todos, nenhum banco é alterado até todos os planos serem conhecidos.
    for (const db of selecionados) {
      try {
        const plano = await planejar(db, catalogo);
        planos.push(plano);
        mostrar(plano);
      } catch (erro) {
        throw new Error(`Planejamento falhou em ${db.label}: ${erro instanceof Error ? erro.message : erro}`);
      }
    }
    if (!escrever) {
      console.log("\nDRY RUN: nenhuma gravação.");
      return;
    }
    console.log("\nAplicando o plano exibido acima.");
    const concluidos: string[] = [];
    const falhas: string[] = [];
    for (const plano of planos) {
      try {
        await aplicar(plano, catalogo);
        await verificarAl(plano);
        concluidos.push(plano.db.label);
        console.log(`Concluído: ${plano.db.label}`);
      } catch (erro) {
        const falha = `${plano.db.label}: ${erro instanceof Error ? erro.message : erro}`;
        falhas.push(falha);
        console.error(`FALHA: ${falha}`);
      }
    }
    console.log(`Concluídos: ${concluidos.join(", ") || "nenhum"}`);
    if (falhas.length) throw new Error(`Rollout parcial: ${falhas.join(" | ")}`);
  } finally {
    await Promise.all(planos.map(({ client }) => client.end().catch(() => undefined)));
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
