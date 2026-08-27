/**
 * Complemento idempotente da migracao historica para as 10 OS concluidas da
 * placa PNR5F15. A troca de titularidade foi confirmada manualmente: cada OS
 * permanece ligada ao cliente informado na propria linha da planilha.
 *
 * Uso:
 *   npm run migracao:garage:os-pnr5f15
 *   npm run migracao:garage:os-pnr5f15 -- --aplicar
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const APLICAR = new Set(process.argv.slice(2)).has("--aplicar");
const DIRETORIO_FONTE = path.join(projectRoot, "docs", "migracao_garagepremium");
const NOME_ARQUIVO = fs
  .readdirSync(DIRETORIO_FONTE)
  .find((nome) => nome.startsWith("EXPORT") && nome.endsWith("OS.xlsx"));
if (!NOME_ARQUIVO) throw new Error("Planilha de exportacao das OS nao encontrada.");
const ARQUIVO = path.join(DIRETORIO_FONTE, NOME_ARQUIVO);
const HASH_ESPERADO = "1526E77348871B041ED3B8D1FC6F954C1EDDFCC535188C51AADA7CA1E6E51903";
const PREFIXO = "LEGADO_OS_EXPORTACAO:";
const PLACA = "PNR5F15";
const CHASSI = "SALRA2BK7JA061526";
const REGISTROS = new Set([1730, 2208, 2264, 2543, 2613, 3264, 3296, 3554, 3560, 4002]);
const CRIADOR_EMAIL = "brunolima@figosoftwares.com.br";
const SETOR_ID = 1;

type Linha = unknown[];
type ClienteBanco = { id: number; cpfcnpj: string; nomerazaosocial: string };

function texto(valor: unknown) {
  return valor == null ? "" : String(valor).trim();
}

function compacto(valor: unknown) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function documento(valor: unknown) {
  const digitos = texto(valor).replace(/\D/g, "");
  if (!digitos) return "";
  return digitos.length <= 11 ? digitos.padStart(11, "0") : digitos.padStart(14, "0");
}

function inteiroPositivo(valor: unknown) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? Math.trunc(numero) : null;
}

function ano(valor: unknown) {
  const numero = inteiroPositivo(valor);
  return numero != null && numero >= 1900 && numero <= 2100 ? numero : null;
}

function dataIso(valor: unknown) {
  if (typeof valor === "number") {
    const partes = XLSX.SSF.parse_date_code(valor);
    if (partes) {
      return `${partes.y}-${String(partes.m).padStart(2, "0")}-${String(partes.d).padStart(2, "0")}`;
    }
  }
  return null;
}

function meiaNoiteBrasil(data: string) {
  return `${data}T00:00:00-03:00`;
}

function lerLinhas() {
  const conteudo = fs.readFileSync(ARQUIVO);
  const hash = crypto.createHash("sha256").update(conteudo).digest("hex").toUpperCase();
  if (hash !== HASH_ESPERADO) {
    throw new Error(`A planilha mudou desde a conferencia. SHA-256 atual: ${hash}`);
  }

  const workbook = XLSX.read(conteudo);
  const aba = workbook.SheetNames[0];
  if (!aba) throw new Error("A planilha nao possui abas.");
  const matriz = XLSX.utils.sheet_to_json<Linha>(workbook.Sheets[aba], {
    header: 1,
    defval: null,
    raw: true,
  });

  const todasDaPlaca = matriz
    .slice(1)
    .filter((linha) => compacto(linha[26]) === PLACA);
  const concluidas = todasDaPlaca.filter(
    (linha) =>
      compacto(linha[13]) === "CONCLUIDOCOMEXITO" &&
      Number(linha[18]) === 0 &&
      Number(linha[57]) === -1,
  );

  const encontrados = new Set(concluidas.map((linha) => Number(linha[0])));
  if (
    todasDaPlaca.length !== 12 ||
    concluidas.length !== REGISTROS.size ||
    encontrados.size !== REGISTROS.size ||
    [...REGISTROS].some((registro) => !encontrados.has(registro))
  ) {
    throw new Error("Os registros da PNR5F15 divergiram da revisao manual.");
  }
  if (new Set(todasDaPlaca.map((linha) => compacto(linha[35]))).size !== 1 || compacto(concluidas[0][35]) !== CHASSI) {
    throw new Error("O chassi da PNR5F15 divergiu da revisao manual.");
  }
  return concluidas;
}

function snapshotVeiculo(linha: Linha) {
  const renavamDigitos = texto(linha[27]).replace(/\D/g, "");
  return {
    placa: PLACA,
    marca: texto(linha[23]) || null,
    modelo: texto(linha[24]) || null,
    ano_fabricacao: ano(linha[25]),
    ano_modelo: ano(linha[59]),
    chassi: CHASSI,
    renavam: renavamDigitos ? renavamDigitos.padStart(11, "0") : null,
    cor: texto(linha[34]) || null,
    combustivel: texto(linha[36]) || null,
    km: inteiroPositivo(linha[30]),
    descricao_veiculo: texto(linha[33]) || null,
  };
}

function observacoes(linha: Linha) {
  return [
    texto(linha[5]) ? `Observacao da OS: ${texto(linha[5])}` : null,
    texto(linha[29]) ? `Observacoes gerais: ${texto(linha[29])}` : null,
    inteiroPositivo(linha[30]) != null ? `Quilometragem informada: ${inteiroPositivo(linha[30])} km` : null,
    texto(linha[6]) ? `Vendedor no sistema anterior: ${texto(linha[6])}` : null,
    `Registro legado: ${texto(linha[0])}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const linhas = lerLinhas();
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");

  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - complemento ${PLACA}`);
  const { client } = await connectDatabase(configuracao);
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${PREFIXO}${PLACA}`]);

    const clientesRes = await client.query<ClienteBanco>(
      `select id, cpfcnpj, nomerazaosocial
         from public.cliente
        where coalesce(is_deleted, false) = false`,
    );
    const clientesPorDocumento = new Map<string, ClienteBanco>();
    for (const cliente of clientesRes.rows) {
      const chave = documento(cliente.cpfcnpj);
      if (!chave) continue;
      if (clientesPorDocumento.has(chave)) throw new Error(`CPF/CNPJ duplicado no Garage Premium: ${chave}`);
      clientesPorDocumento.set(chave, cliente);
    }

    const linhasInsercao = linhas.map((linha) => {
      const cliente = clientesPorDocumento.get(documento(linha[15]));
      if (!cliente || compacto(cliente.nomerazaosocial) !== compacto(linha[1])) {
        throw new Error(`Cliente nao confirmado no registro legado ${texto(linha[0])}.`);
      }
      const data = dataIso(linha[4]);
      if (!data) throw new Error(`Data invalida no registro legado ${texto(linha[0])}.`);
      return {
        clienteid: cliente.id,
        veiculoid: null,
        descricao: texto(linha[28]) || `Ordem de servico historica #${texto(linha[0])}`,
        dataentrada: meiaNoiteBrasil(data),
        observacoes: observacoes(linha),
        createdat: meiaNoiteBrasil(data),
        updatedat: meiaNoiteBrasil(data),
        migracao_referencia: `${PREFIXO}${texto(linha[0])}`,
        veiculo_snapshot: snapshotVeiculo(linha),
      };
    });
    if (new Set(linhasInsercao.map((linha) => linha.clienteid)).size !== 3) {
      throw new Error("A carga deveria preservar exatamente tres titulares.");
    }

    const veiculoConflitante = await client.query(
      `select id from public.veiculo
        where regexp_replace(upper(coalesce(placa, '')), '[^A-Z0-9]', '', 'g') = $1
           or regexp_replace(upper(coalesce(chassi, '')), '[^A-Z0-9]', '', 'g') = $2`,
      [PLACA, CHASSI],
    );
    if (veiculoConflitante.rowCount) {
      throw new Error("Ja existe veiculo com a placa ou chassi da carga; revise antes de vincular.");
    }

    const referencias = linhasInsercao.map((linha) => linha.migracao_referencia);
    const existentes = await client.query(
      `select migracao_referencia from public.ordemservico
        where migracao_referencia = any($1::text[])`,
      [referencias],
    );
    if (existentes.rowCount === REGISTROS.size) {
      console.log("As 10 OS ja estavam migradas; nenhuma alteracao necessaria.");
      await client.query("ROLLBACK");
      return;
    }
    if (existentes.rowCount) {
      throw new Error(`Carga parcial encontrada: ${existentes.rowCount} de ${REGISTROS.size} OS.`);
    }

    const criadorRes = await client.query<{ id: string; nome: string }>(
      `select id, nome from public.usuario where lower(email) = lower($1) and ativo = true`,
      [CRIADOR_EMAIL],
    );
    if (criadorRes.rowCount !== 1) throw new Error(`Usuario tecnico nao encontrado: ${CRIADOR_EMAIL}`);
    const setorRes = await client.query<{ id: number; nome: string }>(
      `select id, nome from public.setor where id = $1`,
      [SETOR_ID],
    );
    if (setorRes.rowCount !== 1) throw new Error(`Setor da migracao nao encontrado: ${SETOR_ID}`);

    console.log("Candidatas validadas: 10 OS, 3 titulares e 1 snapshot de veiculo por OS.");
    if (!APLICAR) {
      console.log("Simulacao concluida sem INSERT; a sequencia de IDs foi preservada.");
      await client.query("ROLLBACK");
      return;
    }

    const antes = await client.query<{ clientes: number; veiculos: number }>(
      `select
         (select count(*)::int from public.cliente) clientes,
         (select count(*)::int from public.veiculo) veiculos`,
    );
    const criador = criadorRes.rows[0];
    const insercao = await client.query<{ id: number; migracao_referencia: string }>(
      `insert into public.ordemservico (
         clienteid, veiculoid, usuariocriadorid, setorid, status, statusaprovacao,
         descricao, dataentrada, datasaida, orcamentototal, valor_frete, subtotal,
         observacoes, createdat, updatedat, prioridade, alvo_tipo, created_by,
         updated_by, is_deleted, pagamento_concluido_em, finalizado_em, forma_pagamento,
         parcelas_pagamento, pagamentos_previstos, migracao_referencia, veiculo_snapshot
       )
       select
         x.clienteid, null, $2::uuid, $3::integer,
         'CONCLUIDO'::public.enum_status_os, 'APROVADA'::public.enum_status_aprovacao,
         x.descricao, x.dataentrada::timestamptz, x.dataentrada::timestamptz, 0, 0, 0,
         x.observacoes, x.createdat::timestamptz, x.updatedat::timestamptz,
         'NORMAL'::public.enum_prioridade_os, 'VEICULO'::public.enum_alvo_reparo,
         $2::uuid, $2::uuid, false, x.dataentrada::timestamptz, x.dataentrada::timestamptz,
         null, null, null, x.migracao_referencia, x.veiculo_snapshot
       from jsonb_to_recordset($1::jsonb) as x(
         clienteid integer, descricao text, dataentrada text, observacoes text,
         createdat text, updatedat text, migracao_referencia text, veiculo_snapshot jsonb
       )
       returning id, migracao_referencia`,
      [JSON.stringify(linhasInsercao), criador.id, SETOR_ID],
    );
    if (insercao.rowCount !== REGISTROS.size) {
      throw new Error(`Foram inseridas ${insercao.rowCount} OS; esperado: ${REGISTROS.size}.`);
    }

    const saidas = await client.query(
      `insert into public.os_saida (
         ordemservico_id, saida_em, retirado_por, documento_observacao,
         registrado_por, created_by, created_at, updated_at
       )
       select
         os.id, os.dataentrada, 'Registro historico migrado',
         'Saida registrada a partir do historico do sistema legado.',
         coalesce(os.usuariocriadorid, os.created_by),
         coalesce(os.created_by, os.usuariocriadorid), os.dataentrada, os.dataentrada
       from public.ordemservico os
       where os.migracao_referencia = any($1::text[])
       on conflict (ordemservico_id) do nothing`,
      [referencias],
    );
    if (saidas.rowCount !== REGISTROS.size) {
      throw new Error(`Foram inseridas ${saidas.rowCount} saidas; esperado: ${REGISTROS.size}.`);
    }

    const auditoria = await client.query<{
      total: number;
      titulares: number;
      datas_inconsistentes: number;
      saidas: number;
      efeitos: number;
      clientes: number;
      veiculos: number;
    }>(
      `select
         count(*)::int total,
         count(distinct os.clienteid)::int titulares,
         count(*) filter (
           where os.status::text <> 'CONCLUIDO'
              or os.veiculoid is not null
              or os.veiculo_snapshot ->> 'placa' <> $2
              or os.datasaida is distinct from os.dataentrada
              or os.pagamento_concluido_em is distinct from os.dataentrada
              or os.finalizado_em is distinct from os.dataentrada
              or coalesce(os.orcamentototal, 0) <> 0
              or coalesce(os.subtotal, 0) <> 0
              or coalesce(os.valor_frete, 0) <> 0
         )::int datas_inconsistentes,
         (select count(*)::int from public.os_saida s join public.ordemservico o2 on o2.id = s.ordemservico_id where o2.migracao_referencia = any($1::text[])) saidas,
         (select count(*)::int from public.transacao t join public.ordemservico o2 on o2.id = t.ordemservicoid where o2.migracao_referencia = any($1::text[]))
           + (select count(*)::int from public.pagamento p join public.ordemservico o2 on o2.id = p.ordemservicoid where o2.migracao_referencia = any($1::text[]))
           + (select count(*)::int from public.eventos_financeiros e join public.ordemservico o2 on o2.id = e.ordemservicoid where o2.migracao_referencia = any($1::text[]))
           + (select count(*)::int from public.os_notificacao_evento n join public.ordemservico o2 on o2.id = n.ordemservico_id where o2.migracao_referencia = any($1::text[]))
           + (select count(*)::int from public.osproduto p join public.ordemservico o2 on o2.id = p.ordemservicoid where o2.migracao_referencia = any($1::text[]))
           + (select count(*)::int from public.osservico s join public.ordemservico o2 on o2.id = s.ordemservicoid where o2.migracao_referencia = any($1::text[])) efeitos,
         (select count(*)::int from public.cliente) clientes,
         (select count(*)::int from public.veiculo) veiculos
       from public.ordemservico os
       where os.migracao_referencia = any($1::text[])`,
      [referencias, PLACA],
    );
    const validacao = auditoria.rows[0];
    if (
      validacao.total !== REGISTROS.size ||
      validacao.titulares !== 3 ||
      validacao.datas_inconsistentes !== 0 ||
      validacao.saidas !== REGISTROS.size ||
      validacao.efeitos !== 0 ||
      validacao.clientes !== antes.rows[0].clientes ||
      validacao.veiculos !== antes.rows[0].veiculos
    ) {
      throw new Error(`Auditoria pos-carga falhou: ${JSON.stringify(validacao)}`);
    }

    await client.query("COMMIT");
    console.log(`Carga confirmada: IDs ${insercao.rows.map((item) => item.id).join(", ")}.`);
    console.log("Clientes e veiculos criados: 0. Efeitos financeiros e notificacoes: 0.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
