/**
 * Auditoria do ICMS das NF-e autorizadas: banco × snapshot × XML.
 *
 *   npx tsx scripts/nfe/auditar-icms-emitidas.ts [demir|demo|garage] [pasta-de-saida]
 *
 * SOMENTE LEITURA: roda numa transação READ ONLY e termina em ROLLBACK. Nenhuma
 * nota é alterada — regularizar documento autorizado é trabalho separado, com a
 * contabilidade.
 *
 * Cada nota recebe uma ou mais classes:
 *
 *   A  divergência técnica banco × XML: nfe_item/snapshot dizem uma coisa e o
 *      XML autorizado diz outra (ICMS próprio gravado que o XML não tem, CST
 *      gravado diferente do CST do XML). Prova só que o ERP gravou errado — não
 *      que a nota está fiscalmente errada.
 *   B  possível classificação incorreta: a descrição oficial do CFOP contradiz o
 *      papel da ST no CST/CSOSN (mesma regra que a emissão passou a avisar).
 *   D  precisa de revisão humana/contábil: o ERP não tem como decidir sozinho
 *      (indFinal presumido para contribuinte, CST 60 interestadual sem ST
 *      informada, NCM usado com mais de um CEST na própria base).
 *   C  aparentemente coerente: nenhuma das anteriores.
 *
 * Saída: auditoria-icms-<banco>.csv (um item por linha) e o resumo no console.
 */
import fs from "node:fs";
import path from "node:path";

import { XMLParser } from "fast-xml-parser";

import { connectDatabase, loadDatabaseConfigs, type DatabaseKey } from "../db/lib";
import { icmsVazio, resolverTratamentoIcms, validarCoerenciaCfopIcms } from "../../src/lib/nfe/icms";
import type { CRT } from "../../src/lib/nfe/types";

type LinhaNota = {
  id: string;
  numero: number;
  serie: number;
  dataemissao: string;
  chave_acesso: string;
  vendaid: number | null;
  ordemservicoid: number | null;
  entradaid: number | null;
  saidaid: number | null;
  dados_avulsos: any;
  xml_autorizado: string;
};

type LinhaItem = {
  nfe_id: string;
  n_item: number;
  cst: string | null;
  csosn: string | null;
  cfop: string | null;
  ncm: string | null;
  cest: string | null;
  aliquotaicms: string | null;
  valor_bc_icms: string | null;
  valor_icms: string | null;
  tributacao_snapshot: any;
};

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

function lista<T>(valor: T | T[] | undefined): T[] {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function num(valor: unknown): number | null {
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function digitos(valor: unknown, tamanho?: number) {
  const d = String(valor ?? "").replace(/\D/g, "");
  return tamanho && d ? d.padStart(tamanho, "0").slice(-tamanho) : d;
}

function diferente(a: number | null, b: number | null) {
  return Math.abs((a ?? 0) - (b ?? 0)) > 0.009;
}

function origemDaNota(nota: LinhaNota) {
  if (nota.vendaid) return "VENDA";
  if (nota.ordemservicoid) return "OS";
  if (nota.entradaid) return "ENTRADA";
  if (nota.saidaid) return "SAIDA";
  return "AVULSA";
}

function lerXml(xml: string) {
  const doc = parser.parse(xml);
  const infNFe = doc?.nfeProc?.NFe?.infNFe ?? doc?.NFe?.infNFe;
  const ide = infNFe?.ide ?? {};
  return {
    crt: Number(infNFe?.emit?.CRT) as CRT,
    idDest: String(ide.idDest ?? ""),
    indFinal: String(ide.indFinal ?? ""),
    indIEDest: String(infNFe?.dest?.indIEDest ?? ""),
    itens: lista<any>(infNFe?.det).map((det) => {
      const icms = det?.imposto?.ICMS ?? {};
      const grupo = Object.keys(icms)[0] ?? "";
      const campos = icms[grupo] ?? {};
      return {
        nItem: Number(det?.["@_nItem"]),
        cfop: digitos(det?.prod?.CFOP),
        ncm: digitos(det?.prod?.NCM),
        cest: digitos(det?.prod?.CEST),
        grupo,
        cst: campos.CST !== undefined ? digitos(campos.CST, 2) : null,
        csosn: campos.CSOSN !== undefined ? digitos(campos.CSOSN, 3) : null,
        orig: String(campos.orig ?? ""),
        vBC: num(campos.vBC),
        vICMS: num(campos.vICMS),
        vBCST: num(campos.vBCST),
        vBCSTRet: num(campos.vBCSTRet),
      };
    }),
  };
}

function csv(valor: unknown) {
  const texto = String(valor ?? "");
  return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

async function main() {
  const chave = (process.argv[2] ?? "demir") as DatabaseKey;
  const saida = process.argv[3] ?? process.cwd();
  const banco = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!banco) throw new Error(`Banco ${chave} não configurado.`);

  const { client } = await connectDatabase(banco);
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const { rows: notas } = await client.query<LinhaNota>(`
      SELECT id, numero, serie, dataemissao, chave_acesso, vendaid, ordemservicoid, entradaid, saidaid,
             dados_avulsos, xml_autorizado
        FROM public.nfe
       WHERE status = 'AUTORIZADA' AND modelo = 'NFE' AND xml_autorizado IS NOT NULL
         AND coalesce(is_deleted, false) = false
       ORDER BY dataemissao, numero`);
    const { rows: itens } = await client.query<LinhaItem>(
      `SELECT nfe_id, n_item, cst, csosn, cfop, ncm, cest, aliquotaicms, valor_bc_icms, valor_icms, tributacao_snapshot
         FROM public.nfe_item WHERE nfe_id = ANY($1::bigint[])`,
      [notas.map((nota) => nota.id)],
    );
    await client.query("ROLLBACK");

    const itensPorNota = new Map<string, LinhaItem[]>();
    for (const item of itens) {
      const chaveNota = String(item.nfe_id);
      itensPorNota.set(chaveNota, [...(itensPorNota.get(chaveNota) ?? []), item]);
    }

    // CEST usados por NCM na própria base: um NCM com mais de um CEST é indício
    // (não prova) de classificação a revisar. A tabela do Conv. ICMS 142/2018
    // ainda não está no ERP para validar de verdade.
    const cestsPorNcm = new Map<string, Set<string>>();
    const xmlPorNota = new Map(notas.map((nota) => [nota.id, lerXml(nota.xml_autorizado)]));
    for (const xml of xmlPorNota.values()) {
      for (const item of xml.itens) {
        if (!item.cest) continue;
        cestsPorNcm.set(item.ncm, (cestsPorNcm.get(item.ncm) ?? new Set()).add(item.cest));
      }
    }

    const linhas: string[] = [[
      "nfe_id", "numero", "serie", "data", "origem", "chave", "n_item", "classes", "motivos",
      "grupo_xml", "cst_xml", "csosn_xml", "cst_banco", "cfop", "ncm", "cest", "idDest", "indFinal", "indIEDest",
      "bc_banco", "icms_banco", "bc_xml", "icms_xml", "bc_snapshot", "aliquota_banco",
    ].join(";")];
    const porClasse = new Map<string, Set<string>>();
    const porClasseItens = new Map<string, number>();
    const porOrigemA = new Map<string, Set<string>>();
    let icmsFicticio = 0;

    for (const nota of notas) {
      const xml = xmlPorNota.get(nota.id)!;
      const origem = origemDaNota(nota);
      const destinoInformado = Boolean(nota.dados_avulsos?.operacao?.destinoMercadoria);
      for (const itemXml of xml.itens) {
        const banco = (itensPorNota.get(String(nota.id)) ?? []).find((item) => Number(item.n_item) === itemXml.nItem);
        const classes = new Set<string>();
        const motivos: string[] = [];

        const bcBanco = num(banco?.valor_bc_icms);
        const icmsBanco = num(banco?.valor_icms);
        const bcSnapshot = num(banco?.tributacao_snapshot?.baseCalculoIcms);
        if (diferente(bcBanco, itemXml.vBC) || diferente(icmsBanco, itemXml.vICMS)) {
          classes.add("A");
          motivos.push(
            itemXml.vBC === null
              ? `ICMS próprio gravado no banco (${icmsBanco ?? 0}) que o grupo ${itemXml.grupo} do XML não tem`
              : `ICMS próprio do banco (${icmsBanco ?? 0}) difere do XML (${itemXml.vICMS ?? 0})`,
          );
          if (itemXml.vICMS === null) icmsFicticio += icmsBanco ?? 0;
        }
        if (bcSnapshot !== null && diferente(bcSnapshot, itemXml.vBC)) {
          classes.add("A");
          motivos.push(`snapshot com base ${bcSnapshot} e XML com ${itemXml.vBC ?? 0}`);
        }
        const cstBanco = banco?.cst ? digitos(banco.cst, 2) : null;
        if (itemXml.cst && cstBanco && cstBanco !== itemXml.cst) {
          classes.add("A");
          motivos.push(`CST gravado ${banco?.cst} e CST do XML ${itemXml.cst}`);
        }

        const tratamento = resolverTratamentoIcms({ crt: xml.crt, cst: itemXml.cst, csosn: itemXml.csosn });
        if (tratamento) {
          const valores = { ...icmsVazio(tratamento, itemXml.orig), vBCST: itemXml.vBCST };
          for (const aviso of validarCoerenciaCfopIcms({ cfop: itemXml.cfop, tratamento, valores })) {
            classes.add("B");
            motivos.push(aviso.code);
          }
          const stAnterior =
            tratamento.natureza === "ST_RETIDA_ANTERIORMENTE" || tratamento.natureza === "SN_ST_RETIDA_ANTERIORMENTE";
          if (stAnterior && xml.idDest === "2" && itemXml.vBCSTRet === null) {
            classes.add("D");
            motivos.push("ST cobrada anteriormente em operação interestadual, sem ST retida informada");
          }
        }
        if (xml.indFinal === "1" && xml.indIEDest === "1" && !destinoInformado && origem !== "ENTRADA") {
          classes.add("D");
          motivos.push("indFinal=1 para contribuinte, presumido pelo ERP (destino da mercadoria não informado)");
        }
        if (itemXml.cest && (cestsPorNcm.get(itemXml.ncm)?.size ?? 0) > 1) {
          classes.add("D");
          motivos.push(`NCM ${itemXml.ncm} usado com mais de um CEST na base (${[...cestsPorNcm.get(itemXml.ncm)!].join(", ")})`);
        }
        if (classes.size === 0) classes.add("C");

        for (const classe of classes) {
          porClasse.set(classe, (porClasse.get(classe) ?? new Set()).add(nota.id));
          porClasseItens.set(classe, (porClasseItens.get(classe) ?? 0) + 1);
        }
        if (classes.has("A")) porOrigemA.set(origem, (porOrigemA.get(origem) ?? new Set()).add(nota.id));

        linhas.push([
          nota.id, nota.numero, nota.serie, String(nota.dataemissao).slice(0, 10), origem, nota.chave_acesso,
          itemXml.nItem, [...classes].sort().join(""), motivos.join(" | "),
          itemXml.grupo, itemXml.cst, itemXml.csosn, banco?.cst, itemXml.cfop, itemXml.ncm, itemXml.cest,
          xml.idDest, xml.indFinal, xml.indIEDest,
          bcBanco, icmsBanco, itemXml.vBC, itemXml.vICMS, bcSnapshot, banco?.aliquotaicms,
        ].map(csv).join(";"));
      }
    }

    fs.mkdirSync(saida, { recursive: true });
    const arquivo = path.join(saida, `auditoria-icms-${chave}.csv`);
    fs.writeFileSync(arquivo, "﻿" + linhas.join("\n"));

    console.log(`Auditoria ICMS — ${banco.label} (somente leitura)`);
    console.log(`  NF-e autorizadas: ${notas.length}; itens: ${linhas.length - 1}`);
    for (const classe of ["A", "B", "C", "D"]) {
      console.log(`  Classe ${classe}: ${porClasse.get(classe)?.size ?? 0} notas, ${porClasseItens.get(classe) ?? 0} itens`);
    }
    console.log(`  A por origem: ${[...porOrigemA].map(([origem, ids]) => `${origem} ${ids.size}`).join(", ") || "—"}`);
    console.log(`  ICMS próprio gravado no banco sem correspondente no XML: R$ ${icmsFicticio.toFixed(2)}`);
    console.log(`  Detalhe por item: ${arquivo}`);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
