/**
 * Regera `src/data/municipios-por-uf.json`.
 *
 *   node scripts/localidades/gerar-municipios.mjs
 *
 * A lista de municipios muda raramente (criacao/fusao de municipio). Rode este
 * script quando isso acontecer; ele so escreve o arquivo se as duas fontes
 * concordarem em TODOS os codigos IBGE, de todas as 27 UFs.
 *
 * Fonte primaria: kelvins/municipios-brasileiros (grafia igual a do IBGE, o que
 * importa porque `cliente.cidade` ja foi gravado nesse formato).
 * Validacao: BrasilAPI, que serve dados do IBGE. Devolve nomes em caixa alta,
 * entao serve para conferir codigos, nao a grafia.
 *
 * O IBGE oficial (servicodados.ibge.gov.br) nao e usado aqui de proposito: a
 * instabilidade dele foi justamente o motivo de embutir a lista.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESTINO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/data/municipios-por-uf.json",
);

const CSV_MUNICIPIOS = "https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv";
const CSV_ESTADOS = "https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/estados.csv";

async function baixar(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`${url} respondeu ${resp.status}`);
  return resp.text();
}

function parseCsv(texto) {
  const linhas = texto.replace(/^﻿/, "").trim().split(/\r?\n/);
  const cabecalho = linhas[0].split(",");
  return linhas.slice(1).map((linha) => {
    const campos = linha.split(",");
    if (campos.length !== cabecalho.length) {
      throw new Error(`Linha com numero de campos inesperado: ${linha}`);
    }
    return Object.fromEntries(cabecalho.map((chave, i) => [chave, campos[i]]));
  });
}

const [textoMunicipios, textoEstados] = await Promise.all([
  baixar(CSV_MUNICIPIOS),
  baixar(CSV_ESTADOS),
]);

const estados = parseCsv(textoEstados);
const ufPorCodigo = new Map(estados.map((e) => [e.codigo_uf, e.uf]));
const municipios = parseCsv(textoMunicipios);

console.log(`CSV: ${municipios.length} municipios, ${estados.length} UFs`);

// Agrupa por sigla de UF
const porUf = {};
for (const m of municipios) {
  const uf = ufPorCodigo.get(m.codigo_uf);
  if (!uf) throw new Error(`codigo_uf desconhecido: ${m.codigo_uf}`);
  const id = Number(m.codigo_ibge);
  if (!Number.isInteger(id) || String(id).length !== 7) {
    throw new Error(`codigo_ibge invalido para ${m.nome}: ${m.codigo_ibge}`);
  }
  (porUf[uf] ??= []).push({ id, nome: m.nome });
}
for (const uf of Object.keys(porUf)) {
  porUf[uf].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// ---- Validacao cruzada contra a BrasilAPI ----
const ufs = Object.keys(porUf).sort();
console.log(`\nValidando ${ufs.length} UFs contra a BrasilAPI...`);

let divergencias = 0;
let totalConferido = 0;

for (const uf of ufs) {
  let referencia;
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/ibge/municipios/v1/${uf}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    referencia = await resp.json();
  } catch (e) {
    console.log(`  ${uf}: NAO VALIDADO (${e.message})`);
    divergencias++;
    continue;
  }

  const codigosLocais = new Set(porUf[uf].map((m) => String(m.id)));
  const codigosRef = new Set(referencia.map((m) => String(m.codigo_ibge)));

  const faltando = [...codigosRef].filter((c) => !codigosLocais.has(c));
  const sobrando = [...codigosLocais].filter((c) => !codigosRef.has(c));

  totalConferido += codigosRef.size;

  if (faltando.length || sobrando.length) {
    divergencias++;
    console.log(`  ${uf}: DIVERGENTE — ${porUf[uf].length} local x ${referencia.length} ref`);
    if (faltando.length) console.log(`      faltando: ${faltando.slice(0, 5).join(", ")}`);
    if (sobrando.length) console.log(`      sobrando: ${sobrando.slice(0, 5).join(", ")}`);
  } else {
    console.log(`  ${uf}: OK (${porUf[uf].length})`);
  }
}

console.log(`\nTotal conferido: ${totalConferido} codigos`);
console.log(divergencias ? `${divergencias} UF(s) com problema` : "Todas as UFs conferem");

if (divergencias === 0) {
  const saida = JSON.stringify(porUf);
  await fs.writeFile(DESTINO, saida);
  console.log(`\nArquivo gerado: ${DESTINO} (${(saida.length / 1024).toFixed(0)} KB)`);
} else {
  console.log("\nArquivo NAO gerado por causa das divergencias.");
  process.exitCode = 1;
}
