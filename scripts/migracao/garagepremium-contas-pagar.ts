/**
 * Migra o saldo em aberto de contas a pagar do sistema anterior para o banco
 * Garage Premium.
 *
 * Uso:
 *   npm run migracao:garage:contas-pagar             -> simula e faz ROLLBACK
 *   npm run migracao:garage:contas-pagar -- --aplicar -> grava com COMMIT
 *
 * Cada parcela vira uma transacao pendente. Parcelas irmas compartilham o
 * mesmo `created_at` e a mesma descricao base, com o sufixo "Parcela N/M",
 * reproduzindo a heuristica usada por /api/transaction/[id]/contexto.
 *
 * A origem ORIGEM_MIGRACAO identifica saldo de abertura e impede que fatos ja
 * reconhecidos no sistema anterior sejam contabilizados novamente na DRE.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const APLICAR = new Set(process.argv.slice(2)).has("--aplicar");
const ORIGEM = "ORIGEM_MIGRACAO";
const MARCADOR = "GARAGEPREMIUM PAGAR #";
const ARQUIVO = path.join(
  projectRoot,
  "docs",
  "migracao_garagepremium",
  "contas a pagar.xlsx",
);
const HASH_ESPERADO =
  "1A0E015BFB9084A670DD420B9BEF94DC786662643B930F48A77DCB724E4D4789";
const QUANTIDADE_ESPERADA = 76;
const TOTAL_ESPERADO_CENTAVOS = 3_867_340;
const JUROS_ESPERADOS_CENTAVOS = 2_293;
const MULTAS_ESPERADAS_CENTAVOS = 9_857;

type Titulo = {
  indice: number;
  fornecedorCodigo: string;
  fornecedorNome: string;
  status: string;
  tipo: string;
  empresa: string;
  numero: string;
  pedido: string;
  notaFiscal: string;
  nfce: string;
  tipoDocumento: string;
  parcelaNumero: number;
  parcelas: number;
  emissao: string;
  vencimento: string;
  diasAtraso: number;
  valorCentavos: number;
  valorCorrigidoCentavos: number;
  descontoCentavos: number;
  jurosCentavos: number;
  multaCentavos: number;
  taxasCentavos: number;
  valorPagoCentavos: number;
  dataPagamento: string | null;
  createdAt: string;
  fornecedorId: number | null;
  fornecedorDocumento: string;
};

type FornecedorBanco = {
  id: number;
  cpfcnpj: string;
  nomerazaosocial: string;
  nomefantasia: string | null;
};

function texto(valor: unknown) {
  return valor == null ? "" : String(valor).trim();
}

function dinheiroEmCentavos(valor: unknown) {
  const original = texto(valor);
  if (!original) return 0;
  const normalizado = /,\d{1,4}$/.test(original)
    ? original.replace(/\./g, "").replace(",", ".")
    : original.replace(/,/g, "");
  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) throw new Error(`Valor monetario invalido: ${original}`);
  return Math.round(numero * 100);
}

function reais(centavos: number) {
  return (centavos / 100).toFixed(2);
}

function dataIso(valor: unknown) {
  const original = texto(valor);
  const match = original.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Data invalida: ${original || "(vazia)"}`);
  const [, dia, mes, ano] = match;
  const iso = `${ano}-${mes}-${dia}`;
  const data = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(data.getTime()) ||
    data.getUTCFullYear() !== Number(ano) ||
    data.getUTCMonth() + 1 !== Number(mes) ||
    data.getUTCDate() !== Number(dia)
  ) {
    throw new Error(`Data invalida: ${original}`);
  }
  return iso;
}

function meiaNoiteBrasil(data: string) {
  return `${data}T00:00:00-03:00`;
}

function normalizarNome(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function lerArquivo() {
  const conteudo = fs.readFileSync(ARQUIVO);
  const hash = crypto.createHash("sha256").update(conteudo).digest("hex").toUpperCase();
  if (hash !== HASH_ESPERADO) {
    throw new Error(`A planilha mudou desde a conferencia. SHA-256 atual: ${hash}`);
  }

  const workbook = XLSX.read(conteudo);
  const primeiraAba = workbook.SheetNames[0];
  if (!primeiraAba) throw new Error("A planilha nao possui abas.");

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[primeiraAba], {
    header: 1,
    defval: null,
    raw: false,
    dateNF: "dd/mm/yyyy",
  });
  const linhas = matriz.slice(1).filter((linha) => linha.some((celula) => celula != null));

  const titulos: Titulo[] = linhas.map((linha, indice) => ({
    indice,
    fornecedorCodigo: texto(linha[0]),
    fornecedorNome: texto(linha[1]),
    status: texto(linha[5]),
    tipo: texto(linha[6]),
    empresa: texto(linha[7]),
    numero: texto(linha[8]),
    pedido: texto(linha[9]),
    notaFiscal: texto(linha[10]),
    nfce: texto(linha[11]),
    tipoDocumento: texto(linha[12]),
    parcelaNumero: Number(linha[13]),
    parcelas: 1,
    emissao: dataIso(linha[14]),
    vencimento: dataIso(linha[15]),
    diasAtraso: Number(linha[16]),
    valorCentavos: dinheiroEmCentavos(linha[17]),
    valorCorrigidoCentavos: dinheiroEmCentavos(linha[18]),
    descontoCentavos: dinheiroEmCentavos(linha[19]),
    jurosCentavos: dinheiroEmCentavos(linha[20]),
    multaCentavos: dinheiroEmCentavos(linha[21]),
    taxasCentavos: dinheiroEmCentavos(linha[22]),
    valorPagoCentavos: dinheiroEmCentavos(linha[23]),
    dataPagamento: texto(linha[24]) || null,
    createdAt: "",
    fornecedorId: null,
    fornecedorDocumento: "NAO INFORMADO",
  }));

  validarFonte(titulos);
  amarrarParcelas(titulos);
  return titulos;
}

function validarFonte(titulos: Titulo[]) {
  const soma = (campo: keyof Titulo) =>
    titulos.reduce((total, titulo) => total + Number(titulo[campo]), 0);

  if (titulos.length !== QUANTIDADE_ESPERADA) {
    throw new Error(`Esperava ${QUANTIDADE_ESPERADA} titulos, encontrei ${titulos.length}.`);
  }
  if (soma("valorCentavos") !== TOTAL_ESPERADO_CENTAVOS) {
    throw new Error(`Total da planilha divergente: R$ ${reais(soma("valorCentavos"))}.`);
  }
  if (soma("valorCorrigidoCentavos") !== TOTAL_ESPERADO_CENTAVOS) {
    throw new Error("O total corrigido deixou de coincidir com o saldo oficial.");
  }
  if (soma("jurosCentavos") !== JUROS_ESPERADOS_CENTAVOS) {
    throw new Error("Total de juros divergente da conferencia anterior.");
  }
  if (soma("multaCentavos") !== MULTAS_ESPERADAS_CENTAVOS) {
    throw new Error("Total de multas divergente da conferencia anterior.");
  }

  const chaves = new Set<string>();
  for (const titulo of titulos) {
    if (
      titulo.status !== "A" ||
      titulo.tipo !== "D" ||
      titulo.empresa !== "MATRIZ" ||
      titulo.tipoDocumento !== "NOTA FISCAL" ||
      titulo.pedido !== "0" ||
      titulo.nfce !== "0" ||
      titulo.dataPagamento !== null ||
      titulo.valorPagoCentavos !== 0 ||
      titulo.descontoCentavos !== 0 ||
      titulo.taxasCentavos !== 0
    ) {
      throw new Error(`Linha ${titulo.indice + 2} nao representa um titulo aberto esperado.`);
    }
    if (!Number.isInteger(titulo.parcelaNumero) || titulo.parcelaNumero < 1) {
      throw new Error(`Parcela invalida na linha ${titulo.indice + 2}.`);
    }
    if (!titulo.fornecedorCodigo || !titulo.fornecedorNome || !titulo.numero || !titulo.notaFiscal) {
      throw new Error(`Identificacao incompleta na linha ${titulo.indice + 2}.`);
    }

    const chave = [titulo.fornecedorCodigo, titulo.numero, titulo.notaFiscal, titulo.parcelaNumero].join("|");
    if (chaves.has(chave)) throw new Error(`Titulo duplicado na fonte: ${chave}.`);
    chaves.add(chave);
  }
}

function chaveAcordo(titulo: Titulo) {
  return [
    titulo.fornecedorCodigo,
    titulo.numero,
    titulo.notaFiscal,
    titulo.emissao,
  ].join("|");
}

function amarrarParcelas(titulos: Titulo[]) {
  const grupos = new Map<string, Titulo[]>();
  for (const titulo of titulos) {
    const chave = chaveAcordo(titulo);
    const grupo = grupos.get(chave) ?? [];
    grupo.push(titulo);
    grupos.set(chave, grupo);
  }

  const instante = Date.now();
  let indiceGrupo = 0;
  for (const [chave, grupo] of grupos) {
    grupo.sort((a, b) => a.parcelaNumero - b.parcelaNumero);
    const numeros = grupo.map((titulo) => titulo.parcelaNumero);
    const vistos = new Set(numeros);
    if (vistos.size !== numeros.length) throw new Error(`Parcela repetida no acordo ${chave}.`);

    const minimo = Math.min(...numeros);
    const maximo = Math.max(...numeros);
    if (numeros.some((numero, indice) => numero !== minimo + indice)) {
      throw new Error(`Ha lacuna entre parcelas abertas no acordo ${chave}.`);
    }

    const createdAt = new Date(instante + indiceGrupo).toISOString();
    indiceGrupo += 1;
    for (const titulo of grupo) {
      titulo.parcelas = maximo;
      titulo.createdAt = createdAt;
    }
  }
}

function descricaoBase(titulo: Titulo) {
  return `NF ${titulo.notaFiscal} - ${titulo.fornecedorNome}`;
}

function descricao(titulo: Titulo) {
  const base = descricaoBase(titulo);
  return titulo.parcelas > 1
    ? `${base} - Parcela ${titulo.parcelaNumero}/${titulo.parcelas}`
    : base;
}

function observacaoDocumento(titulo: Titulo) {
  const ajustes = [];
  if (titulo.jurosCentavos) ajustes.push(`juros informado R$ ${reais(titulo.jurosCentavos)}`);
  if (titulo.multaCentavos) ajustes.push(`multa informada R$ ${reais(titulo.multaCentavos)}`);
  const complemento = ajustes.length
    ? `; ${ajustes.join("; ")}; acrescimos nao incorporados ao saldo migrado`
    : "";
  return (
    `Saldo de abertura do relatorio emitido em 07/08/2026 18:08; ` +
    `fornecedor codigo ${titulo.fornecedorCodigo}; titulo ${titulo.numero}; ` +
    `parcela ${titulo.parcelaNumero}/${titulo.parcelas}${complemento}.`
  );
}

async function main() {
  const titulos = lerArquivo();
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");

  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - ${configuracao.label}`);
  console.log(`Projeto Supabase: ${configuracao.projectRef}`);
  console.log(`Fonte: ${titulos.length} titulos | R$ ${reais(TOTAL_ESPERADO_CENTAVOS)}`);

  const { client } = await connectDatabase(configuracao);
  let idsInseridos: number[] = [];
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [MARCADOR]);

    const funcaoDre = await client.query<{ definicao: string }>(
      `select pg_get_functiondef('public.sincronizar_eventos_financeiros_transacao(bigint)'::regprocedure) definicao`,
    );
    if (!funcaoDre.rows[0]?.definicao.includes("ORIGEM_MIGRACAO")) {
      throw new Error("O banco ainda nao ignora saldos de abertura na DRE.");
    }

    const existente = await client.query<{ n: number; total: string }>(
      `select count(*)::int n, coalesce(sum(valor), 0)::text total
         from public.transacao
        where is_deleted = false and origem = $1 and descricao_pagamento like $2`,
      [ORIGEM, `${MARCADOR}%`],
    );
    if (existente.rows[0].n > 0) {
      throw new Error(
        `Esta carga ja existe: ${existente.rows[0].n} transacoes, total R$ ${existente.rows[0].total}.`,
      );
    }

    const notas = [...new Set(titulos.map((titulo) => titulo.notaFiscal))];
    const candidatos = await client.query<{ id: number; documento_numero: string }>(
      `select id, documento_numero
         from public.transacao
        where is_deleted = false
          and tipo = 'DESPESA'
          and documento_numero = any($1::text[])`,
      [notas],
    );
    if (candidatos.rowCount) {
      throw new Error(
        `Encontrei ${candidatos.rowCount} transacoes existentes com notas da planilha; carga interrompida.`,
      );
    }

    const documento = await client.query<{ id: number }>(
      `select id from public.tipos_documento_transacao where codigo = 'NFE' and ativo limit 1`,
    );
    const documentoTipoId = documento.rows[0]?.id;
    if (!documentoTipoId) throw new Error("Tipo de documento NFE nao cadastrado.");

    const fornecedores = await client.query<FornecedorBanco>(
      `select id, cpfcnpj, nomerazaosocial, nomefantasia
         from public.fornecedor
        where ativo is not false`,
    );
    const fornecedoresPorNome = new Map<string, FornecedorBanco[]>();
    for (const fornecedor of fornecedores.rows) {
      for (const nome of [fornecedor.nomerazaosocial, fornecedor.nomefantasia]) {
        if (!nome) continue;
        const chave = normalizarNome(nome);
        const lista = fornecedoresPorNome.get(chave) ?? [];
        if (!lista.some((item) => item.id === fornecedor.id)) lista.push(fornecedor);
        fornecedoresPorNome.set(chave, lista);
      }
    }

    const fornecedoresAusentes = new Set<string>();
    for (const titulo of titulos) {
      const correspondencias = fornecedoresPorNome.get(normalizarNome(titulo.fornecedorNome)) ?? [];
      if (correspondencias.length > 1) {
        throw new Error(`Mais de um fornecedor corresponde a ${titulo.fornecedorNome}.`);
      }
      const fornecedor = correspondencias[0];
      if (fornecedor) {
        titulo.fornecedorId = fornecedor.id;
        titulo.fornecedorDocumento = fornecedor.cpfcnpj;
      } else {
        fornecedoresAusentes.add(titulo.fornecedorNome);
      }
    }

    for (const titulo of titulos) {
      const marcadorLinha =
        `${MARCADOR}${titulo.numero} | fornecedor ${titulo.fornecedorCodigo} | ` +
        `NF ${titulo.notaFiscal} | parcela ${titulo.parcelaNumero}/${titulo.parcelas}`;
      const inserida = await client.query<{ id: number }>(
        `insert into public.transacao
           (descricao, descricao_pagamento, valor, "valorLiquido", valor_base,
            data, competencia_em, vencimento_em, tipo, fornecedor_id,
            nomepagador, cpfcnpjpagador, pendente, parcelas, origem,
            documento_tipo_id, documento_numero, documento_emitido_em,
            documento_observacao, created_at, updated_at)
         values
           ($1, $2, $3, $3, $3,
            $4::timestamptz, $5::timestamptz, $4::timestamptz, 'DESPESA', $6,
            $7, $8, true, $9, $10,
            $11, $12, $13::date,
            $14, $15::timestamptz, $15::timestamptz)
         returning id`,
        [
          descricao(titulo),
          marcadorLinha,
          reais(titulo.valorCentavos),
          meiaNoiteBrasil(titulo.vencimento),
          meiaNoiteBrasil(titulo.emissao),
          titulo.fornecedorId,
          titulo.fornecedorNome,
          titulo.fornecedorDocumento,
          titulo.parcelas,
          ORIGEM,
          documentoTipoId,
          titulo.notaFiscal,
          titulo.emissao,
          observacaoDocumento(titulo),
          titulo.createdAt,
        ],
      );
      idsInseridos.push(inserida.rows[0].id);
    }

    const conferencia = await client.query<{
      n: number;
      total: string;
      pendentes: number;
      vinculadas: number;
      notas: number;
    }>(
      `select count(*)::int n,
              coalesce(sum(valor), 0)::text total,
              count(*) filter (where pendente)::int pendentes,
              count(*) filter (where fornecedor_id is not null)::int vinculadas,
              count(distinct documento_numero)::int notas
         from public.transacao
        where id = any($1::bigint[])`,
      [idsInseridos],
    );
    const resumo = conferencia.rows[0];
    if (
      resumo.n !== QUANTIDADE_ESPERADA ||
      dinheiroEmCentavos(resumo.total) !== TOTAL_ESPERADO_CENTAVOS ||
      resumo.pendentes !== QUANTIDADE_ESPERADA ||
      resumo.notas !== 38
    ) {
      throw new Error(`Conferencia da carga falhou: ${JSON.stringify(resumo)}.`);
    }

    const grupos = await client.query<{ acordos: number; linhas: number }>(
      `select count(*)::int acordos, coalesce(sum(n), 0)::int linhas
         from (
           select count(*)::int n
             from public.transacao
            where id = any($1::bigint[])
              and descricao ~ ' - Parcela [0-9]+/[0-9]+$'
            group by created_at,
                     regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '')
           having count(*) > 1
         ) grupos`,
      [idsInseridos],
    );
    if (grupos.rows[0].acordos !== 21 || grupos.rows[0].linhas !== 59) {
      throw new Error(`Agrupamento de parcelas divergente: ${JSON.stringify(grupos.rows[0])}.`);
    }

    const eventos = await client.query<{ n: number }>(
      `select count(*)::int n
         from public.eventos_financeiros
        where source_type = 'TRANSACAO'
          and source_id = any($1::bigint[])
          and status = 'ATIVO'`,
      [idsInseridos],
    );
    if (eventos.rows[0].n !== 0) {
      throw new Error(`${eventos.rows[0].n} eventos indevidos seriam criados na DRE.`);
    }

    console.log("\nConferencia dentro da transacao:");
    console.log(`  transacoes: ${resumo.n}`);
    console.log(`  total: R$ ${Number(resumo.total).toFixed(2)}`);
    console.log(`  pendentes: ${resumo.pendentes}`);
    console.log(`  notas fiscais distintas: ${resumo.notas}`);
    console.log(`  vinculadas a fornecedor: ${resumo.vinculadas}`);
    console.log(`  sem fornecedor cadastrado: ${resumo.n - resumo.vinculadas}`);
    console.log(`  parcelamentos agrupados: ${grupos.rows[0].acordos} (${grupos.rows[0].linhas} linhas)`);
    console.log(`  eventos ativos criados na DRE: ${eventos.rows[0].n}`);
    if (fornecedoresAusentes.size) {
      console.log("  fornecedores preservados somente pelo nome:");
      for (const nome of fornecedoresAusentes) console.log(`    - ${nome}`);
    }

    if (APLICAR) {
      await client.query("COMMIT");
      console.log("\nCOMMIT aplicado.");
    } else {
      await client.query("ROLLBACK");
      idsInseridos = [];
      console.log("\nROLLBACK aplicado; a simulacao nao gravou dados.");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }

  if (APLICAR) {
    const verificacao = await connectDatabase(configuracao);
    try {
      const depois = await verificacao.client.query<{
        n: number;
        total: string;
        pendentes: number;
        vinculadas: number;
      }>(
        `select count(*)::int n, coalesce(sum(valor), 0)::text total,
                count(*) filter (where pendente)::int pendentes,
                count(*) filter (where fornecedor_id is not null)::int vinculadas
           from public.transacao
          where is_deleted = false and origem = $1 and descricao_pagamento like $2`,
        [ORIGEM, `${MARCADOR}%`],
      );
      console.log("Releitura apos commit:", depois.rows[0]);
    } finally {
      await verificacao.client.end().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
