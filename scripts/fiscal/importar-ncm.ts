/**
 * Carrega o catálogo de NCM em public.fiscal_ncm a partir do arquivo curado.
 *
 * Uso:
 *   npm run fiscal:ncm -- cespedes              # só o diff, não grava
 *   npm run fiscal:ncm -- cespedes --aplicar    # grava
 *
 * A origem é data/fiscal/ncm/ncm-siscomex.json, gerado do Portal Único
 * Siscomex. Para atualizar quando sair nova Resolução Gecex, baixe de novo:
 *
 *   curl -sSL https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json
 *
 * e regrave o arquivo mantendo o mesmo formato (codigo de 8 dígitos sem
 * pontuação, descricao, inicio, fim).
 *
 * Código que sai da NCM não é apagado: recebe vigencia_fim. Uma nota antiga
 * referencia o NCM que valia na época, e a auditoria precisa achá-lo.
 */
import fs from "node:fs";
import path from "node:path";

import { DATABASE_KEYS, connectDatabase, loadDatabaseConfigs, projectRoot, type DatabaseKey } from "../db/lib";

type NcmCurado = {
  codigo: string;
  descricao: string;
  /** Descrições dos níveis superiores, separadas por " › ". */
  caminho?: string | null;
  inicio?: string | null;
  fim?: string | null;
};

type Arquivo = {
  fonte: string;
  fonteUrl: string;
  ato: string;
  vigencia: string;
  capturadoEm: string;
  ncms: NcmCurado[];
};

const CHAVES_VALIDAS: DatabaseKey[] = [...DATABASE_KEYS];
const LOTE = 1000;

/** O Siscomex publica datas em dd/mm/aaaa; 31/12/9999 quer dizer "sem fim". */
function paraIso(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  if (!m) return null;
  const [, dia, mes, ano] = m;
  if (ano === "9999") return null;
  return `${ano}-${mes}-${dia}`;
}

async function main() {
  const [bancoArg, ...flags] = process.argv.slice(2);
  const aplicar = flags.includes("--aplicar");

  const chave = (bancoArg ?? "cespedes") as DatabaseKey;
  if (!CHAVES_VALIDAS.includes(chave)) {
    throw new Error(`Banco inválido: ${bancoArg}. Use um de: ${CHAVES_VALIDAS.join(", ")}.`);
  }

  const caminho = path.join(projectRoot, "data", "fiscal", "ncm", "ncm-siscomex.json");
  const curado = JSON.parse(fs.readFileSync(caminho, "utf8")) as Arquivo;
  console.log(`Arquivo: ${curado.ncms.length} NCMs — ${curado.ato} (${curado.vigencia}).`);

  const database = loadDatabaseConfigs().find((d) => d.key === chave)!;
  const { client } = await connectDatabase(database);
  console.log(`Banco: ${database.label}\n`);

  try {
    const { rows } = await client.query<{ codigo: string; descricao: string; caminho: string | null }>(
      "SELECT codigo, descricao, caminho FROM public.fiscal_ncm",
    );
    const noBanco = new Map(rows.map((r) => [r.codigo, r]));

    const novos = curado.ncms.filter((n) => !noBanco.has(n.codigo));
    const redescritos = curado.ncms.filter((n) => {
      const atual = noBanco.get(n.codigo);
      if (!atual) return false;
      return atual.descricao !== n.descricao || (atual.caminho ?? "") !== (n.caminho ?? "");
    });
    const doArquivo = new Set(curado.ncms.map((n) => n.codigo));
    const saiuDaNcm = rows.filter((r) => !doArquivo.has(r.codigo));

    console.log(`No banco:     ${rows.length}`);
    console.log(`A inserir:    ${novos.length}`);
    console.log(`A redescrever:${redescritos.length}`);
    console.log(`Saíram da NCM (recebem vigência final, não são apagados): ${saiuDaNcm.length}`);

    if (!aplicar) {
      console.log("\nNada foi gravado. Rode de novo com --aplicar para efetivar.");
      return;
    }

    await client.query("BEGIN");
    for (let i = 0; i < curado.ncms.length; i += LOTE) {
      const lote = curado.ncms.slice(i, i + LOTE);
      const valores: unknown[] = [];
      const linhas = lote.map((n, indice) => {
        const base = indice * 9;
        valores.push(
          n.codigo,
          n.descricao,
          n.caminho ?? null,
          paraIso(n.inicio),
          paraIso(n.fim),
          curado.ato,
          curado.fonte,
          curado.fonteUrl,
          curado.capturadoEm,
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4}::date,$${base + 5}::date,$${base + 6},$${base + 7},$${base + 8},$${base + 9}::date)`;
      });
      await client.query(
        `INSERT INTO public.fiscal_ncm
           (codigo, descricao, caminho, vigencia_inicio, vigencia_fim, ato, fonte, fonte_url, importado_em)
         VALUES ${linhas.join(",")}
         ON CONFLICT (codigo) DO UPDATE SET
           descricao = EXCLUDED.descricao,
           caminho = EXCLUDED.caminho,
           vigencia_inicio = EXCLUDED.vigencia_inicio,
           vigencia_fim = EXCLUDED.vigencia_fim,
           ato = EXCLUDED.ato,
           importado_em = EXCLUDED.importado_em`,
        valores,
      );
    }

    if (saiuDaNcm.length) {
      await client.query(
        `UPDATE public.fiscal_ncm
            SET vigencia_fim = COALESCE(vigencia_fim, $2::date)
          WHERE codigo = ANY($1::char(8)[])`,
        [saiuDaNcm.map((r) => r.codigo), curado.capturadoEm],
      );
    }

    await client.query("COMMIT");
    const total = await client.query("SELECT count(*)::int AS n FROM public.fiscal_ncm");
    console.log(`\nAplicado. Catálogo agora com ${total.rows[0].n} NCMs.`);
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
