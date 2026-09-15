/**
 * Remove do Demir as cópias de fotos que a mídia do anúncio Mercado Livre gravou
 * na galeria do produto.
 *
 * Até 15/09/2026 o envio de arquivo na aba de mídia do anúncio gravava a foto em
 * `produto_imagem`. Como o stepper aberto pelo cadastro do produto só mostrava a
 * capa, fotos já cadastradas foram enviadas de novo pelo anúncio e ficaram
 * duplicadas no produto. As cópias abaixo foram identificadas comparando o
 * conteúdo das imagens (dHash idêntico) e conferidas visualmente: a original de
 * cada uma continua no produto, e o anúncio tem as suas no Mercado Livre.
 *
 * Uso:
 *   npm run db:limpar:fotos-anuncio                # simula, não grava
 *   npm run db:limpar:fotos-anuncio -- --aplicar   # apaga
 *
 * Por segurança a rotina:
 * - conecta exclusivamente ao Demir e recusa chave de outro projeto;
 * - só apaga a cópia se a original ainda estiver no mesmo produto;
 * - nunca apaga a capa do produto;
 * - simula por padrão.
 *
 * O Supabase bloqueia DELETE direto em `storage.objects`, então os arquivos saem
 * pela API do Storage com a chave de serviço do Demir, lida de
 * ERP_SUPABASE_SERVICE_ROLE_KEY_DEMIR (ambiente ou .env.migrations.local) ou, na
 * falta dela, da linha SUPABASE_SERVICE_ROLE_KEY do Demir em .env. A ordem
 * é a mesma da rota de exclusão de imagem: primeiro o arquivo, depois a linha —
 * e só saem as linhas cujos arquivos o Storage confirmou ter removido.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectDatabase, loadDatabaseConfigs, parseSimpleEnv, projectRoot } from "./lib";

const APLICAR = process.argv.slice(2).includes("--aplicar");
const BUCKET = "produto_imagem";
const KEY_ENV = "ERP_SUPABASE_SERVICE_ROLE_KEY_DEMIR";

/** Cópia enviada pelo anúncio → original que permanece, no mesmo produto. */
const COPIAS = [
  { produtoId: 1718, copia: 1700, original: 1698 },
  { produtoId: 1718, copia: 1701, original: 1699 },
  { produtoId: 1719, copia: 1707, original: 1702 },
  { produtoId: 1719, copia: 1708, original: 1704 },
  { produtoId: 1719, copia: 1709, original: 1705 },
  { produtoId: 1719, copia: 1710, original: 1706 },
];

type ImagemRow = { id: string; produto_id: number; path: string; capa: boolean };

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!configuracao) throw new Error("O banco Demir não está configurado.");

  const { client } = await connectDatabase(configuracao);
  try {
    const ids = COPIAS.flatMap((item) => [item.copia, item.original]);
    const { rows } = await client.query<ImagemRow>(
      `SELECT i.id, i.produto_id, i.path, i.url = p."imgUrl" AS capa
         FROM produto_imagem i
         JOIN produto p ON p.id = i.produto_id
        WHERE i.id = ANY($1::bigint[])`,
      [ids],
    );
    const porId = new Map(rows.map((row) => [Number(row.id), row]));

    const apagar: ImagemRow[] = [];
    for (const item of COPIAS) {
      const copia = porId.get(item.copia);
      const original = porId.get(item.original);
      if (!copia) {
        console.log(`#${item.copia}: já não existe, ignorada.`);
        continue;
      }
      if (Number(copia.produto_id) !== item.produtoId) {
        throw new Error(`#${item.copia} não pertence ao produto ${item.produtoId}; nada foi apagado.`);
      }
      if (!original || Number(original.produto_id) !== item.produtoId) {
        throw new Error(`#${item.copia}: a original #${item.original} não está mais no produto ${item.produtoId}; nada foi apagado.`);
      }
      if (copia.capa) throw new Error(`#${item.copia} é a capa do produto ${item.produtoId}; nada foi apagado.`);
      apagar.push(copia);
    }

    console.table(apagar.map((row) => ({ id: row.id, produto: row.produto_id, arquivo: row.path })));
    if (!apagar.length) return;

    const chave = lerChave(configuracao.projectRef);
    if (!APLICAR) {
      console.log(`Simulação: ${apagar.length} cópia(s) seriam apagadas. Rode com --aplicar para gravar.`);
      console.log(chave ? `${KEY_ENV}: configurada.` : `${KEY_ENV}: ausente — necessária para aplicar.`);
      return;
    }
    if (!chave) throw new Error(`Configure ${KEY_ENV} em .env.migrations.local para apagar os arquivos do storage.`);

    const refDaChave = projectRefDaChave(chave);
    if (refDaChave && refDaChave !== configuracao.projectRef) {
      throw new Error(`${KEY_ENV} pertence ao projeto ${refDaChave}, não ao Demir.`);
    }

    const storage = createClient(`https://${configuracao.projectRef}.supabase.co`, chave, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage;
    const { data: removidos, error } = await storage.from(BUCKET).remove(apagar.map((row) => row.path));
    if (error) throw error;

    const caminhosRemovidos = new Set((removidos ?? []).map((item) => item.name));
    const linhas = apagar.filter((row) => caminhosRemovidos.has(row.path));
    const faltaram = apagar.filter((row) => !caminhosRemovidos.has(row.path));

    await client.query("BEGIN");
    try {
      const { rowCount } = await client.query("DELETE FROM produto_imagem WHERE id = ANY($1::bigint[])", [
        linhas.map((row) => row.id),
      ]);
      if (rowCount !== linhas.length) throw new Error(`Esperava apagar ${linhas.length} linha(s); o banco apagaria ${rowCount}.`);
      await client.query("COMMIT");
    } catch (erro) {
      await client.query("ROLLBACK");
      throw erro;
    }

    console.log(`${linhas.length} cópia(s) apagada(s) do produto e do storage.`);
    if (faltaram.length) {
      console.warn(`O Storage não confirmou ${faltaram.length} arquivo(s); as linhas ficaram:`, faltaram.map((row) => row.id));
    }
  } finally {
    await client.end();
  }
}

/**
 * Ordem: ambiente, `.env.migrations.local` e, por fim, as linhas
 * SUPABASE_SERVICE_ROLE_KEY (inclusive comentadas) de `.env.local` e `.env` — o
 * mesmo recurso que `legacyDatabaseUrls` usa para as URLs de banco. Dessas, só
 * vale a chave cujo projeto é o Demir.
 */
function lerChave(projectRef: string) {
  const explicita =
    process.env[KEY_ENV]?.trim() ||
    parseSimpleEnv(path.join(projectRoot, ".env.migrations.local")).get(KEY_ENV)?.trim();
  if (explicita) return explicita;

  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(projectRoot, arquivo);
    if (!fs.existsSync(caminho)) continue;
    const conteudo = fs.readFileSync(caminho, "utf8");
    for (const match of conteudo.matchAll(/^\s*(?:#\s*)?SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?([^"'\s]+)/gm)) {
      if (projectRefDaChave(match[1]) === projectRef) return match[1];
    }
  }
  return "";
}

/** Chaves JWT do Supabase trazem o projeto em `ref`; chaves `sb_secret_` não trazem. */
function projectRefDaChave(chave: string) {
  const partes = chave.split(".");
  if (partes.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return typeof payload?.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
