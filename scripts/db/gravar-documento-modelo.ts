/**
 * Grava um modelo de documento (Configurações > Documentos) num banco, a partir
 * de um arquivo HTML — para entregar o modelo de um cliente sem colar na tela.
 *
 * Uso:
 *   npm run db:documento:gravar -- <banco> <modulo> "<nome>" <arquivo.html>
 *   npm run db:documento:gravar -- <banco> <modulo> "<nome>" <arquivo.html> --ordem 0 --aplicar
 *
 * Sem `--aplicar` termina em ROLLBACK: mostra o que faria e desfaz.
 *
 * Mesmo nome no mesmo módulo (sem contar os excluídos) atualiza o texto daquele
 * modelo em vez de criar outro; o índice único do banco recusaria a cópia.
 * Variável fora do catálogo do módulo barra a gravação: no documento ela sairia
 * escrita como `{{…}}`.
 */
import fs from "node:fs";
import path from "node:path";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";
import { CATALOGOS } from "../../src/lib/documentos/catalogo";
import { variaveisDesconhecidas } from "../../src/lib/documentos/motor";
import { LIMITE_HTML_DOCUMENTO, ehModuloDocumento } from "../../src/lib/documentos/tipos";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const indiceOrdem = args.indexOf("--ordem");
const ORDEM = indiceOrdem >= 0 ? Number(args[indiceOrdem + 1]) : 0;
const [BANCO, MODULO, NOME, ARQUIVO] = args.filter((arg, i) => !arg.startsWith("--") && (indiceOrdem < 0 || i !== indiceOrdem + 1));

async function main() {
  if (!BANCO || !MODULO || !NOME || !ARQUIVO) {
    throw new Error('Uso: npm run db:documento:gravar -- <banco> <modulo> "<nome>" <arquivo.html> [--ordem N] [--aplicar]');
  }
  if (!ehModuloDocumento(MODULO)) throw new Error(`Módulo inválido: ${MODULO} (venda, os ou aluguel).`);
  if (!Number.isInteger(ORDEM) || ORDEM < 0 || ORDEM > 9999) throw new Error("--ordem vai de 0 a 9999.");
  const nome = NOME.trim();
  if (!nome || nome.length > 120) throw new Error("O nome precisa ter de 1 a 120 caracteres.");

  const caminho = path.isAbsolute(ARQUIVO) ? ARQUIVO : path.join(projectRoot, ARQUIVO);
  if (!fs.existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);
  const html = fs.readFileSync(caminho, "utf8").replace(/^﻿/, "");
  if (!html.trim()) throw new Error("O arquivo está vazio.");
  if (html.length > LIMITE_HTML_DOCUMENTO) throw new Error(`O HTML passou de ${LIMITE_HTML_DOCUMENTO} caracteres.`);
  const desconhecidas = variaveisDesconhecidas(html, CATALOGOS[MODULO]);
  if (desconhecidas.length) throw new Error(`Variáveis fora do catálogo de ${MODULO}: ${desconhecidas.join(", ")}`);

  const config = loadDatabaseConfigs().find((item) => item.key === BANCO);
  if (!config) throw new Error(`Banco desconhecido: ${BANCO}`);

  console.log(`\n${nome} (${MODULO}) → ${config.label} — ${APLICAR ? "GRAVANDO" : "simulação"}\n`);
  const { client } = await connectDatabase(config);
  try {
    await client.query("BEGIN");
    const existente = await client.query(
      "select id from public.documento_modelo where modulo = $1 and lower(btrim(nome)) = lower(btrim($2)) and not is_deleted",
      [MODULO, nome],
    );
    const id = existente.rows[0]?.id;
    const resultado = id
      ? await client.query(
          "update public.documento_modelo set html = $2, ordem = $3, ativo = true where id = $1 returning id",
          [id, html, ORDEM],
        )
      : await client.query(
          "insert into public.documento_modelo (modulo, nome, html, ordem) values ($1, $2, $3, $4) returning id",
          [MODULO, nome, html, ORDEM],
        );
    await client.query(APLICAR ? "COMMIT" : "ROLLBACK");
    const acao = id ? "atualizado" : "criado";
    console.log(`  modelo #${resultado.rows[0].id} ${APLICAR ? acao : `seria ${acao} (desfeito)`}`);
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
