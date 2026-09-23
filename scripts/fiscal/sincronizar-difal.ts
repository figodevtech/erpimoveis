/**
 * Compara o arquivo curado de regras de DIFAL com o que está no banco e mostra
 * a diferença. Só grava quando mandado, e nunca apaga histórico.
 *
 * Uso:
 *   npm run fiscal:difal -- demir              # só o diff, não escreve nada
 *   npm run fiscal:difal -- demir --aplicar    # aplica o que o diff mostrou
 *
 * Por que não buscar direto do Portal Nacional do DIFAL aqui: a emissão não
 * pode depender de um site de fora estar no ar, e a tabela do portal não é uma
 * API — é HTML com linhas que às vezes se contradizem. A curadoria fica em
 * data/fiscal/difal/aliquotas-uf.json, revisada por gente, e este script só
 * transporta o que foi revisado.
 *
 * Alteração de alíquota NÃO sobrescreve a linha antiga: fecha a vigência dela
 * (vigencia_fim = véspera) e insere outra. É isso que permite reemitir e
 * auditar uma nota de 2024 com a regra de 2024.
 */
import fs from "node:fs";
import path from "node:path";

import { connectDatabase, loadDatabaseConfigs, projectRoot, type DatabaseKey } from "../db/lib";

type RegraCurada = {
  uf: string;
  tipoRegra: string;
  descricao: string;
  ncm?: string | null;
  ncmPrefixo?: string | null;
  cest?: string | null;
  aliquotaIcmsInterna: number | null;
  aliquotaFcp: number | null;
  reducaoBase?: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  fundamentoLegal?: string | null;
  dataFonte?: string | null;
  ativo?: boolean;
  notaCuradoria?: string | null;
};

type ArquivoCurado = {
  fonte: string;
  fonteUrl: string;
  capturadoEm: string;
  regras: RegraCurada[];
};

const PRIORIDADE: Record<string, number> = {
  GERAL: 10,
  NCM_PREFIXO: 20,
  NCM: 30,
  CEST: 40,
  NCM_CEST: 50,
  BENEFICIO: 60,
  EXCECAO: 70,
};

const CHAVES_VALIDAS: DatabaseKey[] = ["demo", "demir", "garage"];

function chaveDaRegra(r: {
  uf: string;
  tipo_regra?: string;
  tipoRegra?: string;
  ncm?: string | null;
  ncm_prefixo?: string | null;
  ncmPrefixo?: string | null;
  cest?: string | null;
  vigencia_inicio?: string;
  vigenciaInicio?: string;
}) {
  const tipo = r.tipo_regra ?? r.tipoRegra;
  const prefixo = r.ncm_prefixo ?? r.ncmPrefixo ?? "";
  const inicio = String(r.vigencia_inicio ?? r.vigenciaInicio ?? "").slice(0, 10);
  return [r.uf, tipo, r.ncm ?? "", prefixo, r.cest ?? "", inicio].join("|");
}

function decimal(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function mesmoValor(a: number | null, b: number | null) {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-9;
}

async function main() {
  const [bancoArg, ...flags] = process.argv.slice(2);
  const aplicar = flags.includes("--aplicar");

  const chave = (bancoArg ?? "demo") as DatabaseKey;
  if (!CHAVES_VALIDAS.includes(chave)) {
    throw new Error(`Banco inválido: ${bancoArg}. Use um de: ${CHAVES_VALIDAS.join(", ")}.`);
  }

  const caminho = path.join(projectRoot, "data", "fiscal", "difal", "aliquotas-uf.json");
  const curado = JSON.parse(fs.readFileSync(caminho, "utf8")) as ArquivoCurado;
  console.log(`Arquivo curado: ${curado.regras.length} regras (fonte capturada em ${curado.capturadoEm}).`);

  const database = loadDatabaseConfigs().find((d) => d.key === chave)!;
  const { client } = await connectDatabase(database);
  console.log(`Banco: ${database.label}\n`);

  try {
    const { rows } = await client.query(
      `SELECT id, uf, tipo_regra, descricao, ncm, ncm_prefixo, cest,
              aliquota_icms_interna, aliquota_fcp, reducao_base,
              vigencia_inicio::text AS vigencia_inicio, vigencia_fim::text AS vigencia_fim,
              ativo
         FROM public.fiscal_difal_regra`,
    );

    const noBanco = new Map(rows.map((row) => [chaveDaRegra(row), row]));

    const novas: RegraCurada[] = [];
    const alteradas: Array<{ curada: RegraCurada; atual: any; campos: string[] }> = [];
    let iguais = 0;

    for (const regra of curado.regras) {
      const atual = noBanco.get(chaveDaRegra(regra));
      if (!atual) {
        novas.push(regra);
        continue;
      }

      const campos: string[] = [];
      if (!mesmoValor(decimal(atual.aliquota_icms_interna), regra.aliquotaIcmsInterna)) {
        campos.push(
          `interna ${decimal(atual.aliquota_icms_interna)} -> ${regra.aliquotaIcmsInterna}`,
        );
      }
      if (!mesmoValor(decimal(atual.aliquota_fcp), regra.aliquotaFcp)) {
        campos.push(`fcp ${decimal(atual.aliquota_fcp)} -> ${regra.aliquotaFcp}`);
      }
      if ((atual.vigencia_fim ?? null) !== (regra.vigenciaFim ?? null)) {
        campos.push(`vigência_fim ${atual.vigencia_fim ?? "null"} -> ${regra.vigenciaFim ?? "null"}`);
      }
      if (Boolean(atual.ativo) !== (regra.ativo ?? true)) {
        campos.push(`ativo ${atual.ativo} -> ${regra.ativo ?? true}`);
      }

      if (campos.length === 0) iguais += 1;
      else alteradas.push({ curada: regra, atual, campos });
    }

    console.log(`Sem mudança: ${iguais}`);
    console.log(`A inserir:   ${novas.length}`);
    for (const r of novas) {
      console.log(
        `  + ${r.uf} ${r.tipoRegra} interna=${r.aliquotaIcmsInterna} fcp=${r.aliquotaFcp} ` +
          `vigência ${r.vigenciaInicio}..${r.vigenciaFim ?? ""} ativo=${r.ativo ?? true}`,
      );
    }
    console.log(`A alterar:   ${alteradas.length}`);
    for (const a of alteradas) {
      console.log(`  ~ #${a.atual.id} ${a.curada.uf} ${a.curada.tipoRegra}: ${a.campos.join("; ")}`);
    }

    // Linha no banco que o arquivo não descreve nunca é apagada: pode ter sido
    // cadastrada pelo contador direto no sistema.
    const chavesCuradas = new Set(curado.regras.map(chaveDaRegra));
    const soNoBanco = rows.filter((row) => !chavesCuradas.has(chaveDaRegra(row)));
    if (soNoBanco.length) {
      console.log(`\nSó no banco (preservadas, nada será apagado): ${soNoBanco.length}`);
      for (const row of soNoBanco) {
        console.log(`  = #${row.id} ${row.uf} ${row.tipo_regra} desde ${row.vigencia_inicio}`);
      }
    }

    if (!aplicar) {
      console.log("\nNada foi gravado. Rode de novo com --aplicar para efetivar.");
      return;
    }

    if (novas.length === 0 && alteradas.length === 0) {
      console.log("\nNada a aplicar.");
      return;
    }

    await client.query("BEGIN");
    for (const r of novas) {
      await client.query(
        `INSERT INTO public.fiscal_difal_regra (
           uf, tipo_regra, descricao, ncm, ncm_prefixo, cest,
           aliquota_icms_interna, aliquota_fcp, reducao_base,
           vigencia_inicio, vigencia_fim, prioridade,
           fonte, fonte_url, fundamento_legal, data_fonte, ativo, nota_curadoria, importado_em
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT DO NOTHING`,
        [
          r.uf, r.tipoRegra, r.descricao, r.ncm ?? null, r.ncmPrefixo ?? null, r.cest ?? null,
          r.aliquotaIcmsInterna, r.aliquotaFcp, r.reducaoBase ?? null,
          r.vigenciaInicio, r.vigenciaFim, PRIORIDADE[r.tipoRegra] ?? 10,
          curado.fonte, curado.fonteUrl, r.fundamentoLegal ?? null, r.dataFonte ?? null,
          r.ativo ?? true, r.notaCuradoria ?? null, curado.capturadoEm,
        ],
      );
    }
    for (const a of alteradas) {
      // Mesma vigência e outro valor é correção de cadastro, não nova regra:
      // atualiza no lugar. Vigência nova entra como linha nova, pelo arquivo.
      await client.query(
        `UPDATE public.fiscal_difal_regra
            SET aliquota_icms_interna = $2, aliquota_fcp = $3, vigencia_fim = $4,
                ativo = $5, nota_curadoria = $6, fundamento_legal = $7, importado_em = $8
          WHERE id = $1`,
        [
          a.atual.id, a.curada.aliquotaIcmsInterna, a.curada.aliquotaFcp, a.curada.vigenciaFim,
          a.curada.ativo ?? true, a.curada.notaCuradoria ?? null, a.curada.fundamentoLegal ?? null,
          curado.capturadoEm,
        ],
      );
    }
    await client.query("COMMIT");
    console.log(`\nAplicado: ${novas.length} inserções, ${alteradas.length} atualizações.`);
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
