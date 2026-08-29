/**
 * Complemento idempotente para OS historicas cujo unico conflito era a troca
 * de titular do mesmo veiculo ao longo do tempo.
 *
 * Uso:
 *   npm run migracao:garage:os-troca-titularidade
 *   npm run migracao:garage:os-troca-titularidade -- --aplicar
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
const CRIADOR_EMAIL = "brunolima@figosoftwares.com.br";
const SETOR_ID = 1;

const PLACAS_ESPERADAS = new Map<string, number>([
  ["FCV4C21", 6], ["FJS8F80", 4], ["GBT2A13", 3], ["KYU9C33", 11],
  ["LRU4I94", 7], ["OCB1953", 7], ["OEF5E01", 10], ["OFE0271", 6],
  ["OFE3241", 2], ["OGA5I35", 2], ["OGC4059", 3], ["OGC4A59", 4],
  ["OJX7H50", 5], ["OKB1C22", 2], ["OVN9A68", 4], ["OWE2D03", 16],
  ["OYL7E21", 3], ["PCD7A73", 2], ["PDY3G59", 8], ["PFS9696", 13],
  ["PSZ1B09", 4], ["QFK5086", 3], ["QFK6I82", 2], ["QFL0H82", 3],
  ["QFW2A02", 2], ["QFY5C09", 7], ["QJT7I51", 8], ["QSD2317", 3],
  ["QSE6C78", 3], ["QSK0G00", 7], ["QYG1D53", 2], ["RCO0H27", 2],
  ["RGN1A06", 3], ["SBW2C36", 2],
]);
const QUANTIDADE_TOTAL = [...PLACAS_ESPERADAS.values()].reduce((soma, total) => soma + total, 0);
if (QUANTIDADE_TOTAL !== 169) throw new Error("A lista confirmada deveria conter 169 OS.");

type Linha = unknown[];
type ClienteBanco = { id: number; cpfcnpj: string; nomerazaosocial: string };
type LinhaInsercao = {
  clienteid: number;
  descricao: string;
  dataentrada: string;
  observacoes: string;
  createdat: string;
  updatedat: string;
  migracao_referencia: string;
  veiculo_snapshot: Record<string, unknown>;
};

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
  if (typeof valor !== "number") return null;
  const partes = XLSX.SSF.parse_date_code(valor);
  if (!partes) return null;
  return `${partes.y}-${String(partes.m).padStart(2, "0")}-${String(partes.d).padStart(2, "0")}`;
}

function meiaNoiteBrasil(data: string) {
  return `${data}T00:00:00-03:00`;
}

function valores<T>(linhas: Linha[], obter: (linha: Linha) => T | null | "") {
  return new Set(linhas.map(obter).filter((valor): valor is T => valor !== null && valor !== ""));
}

function assinaturaNatural(linha: Linha) {
  return [
    documento(linha[15]),
    compacto(linha[26]),
    texto(linha[4]),
    compacto(linha[28]),
    compacto(linha[29]),
  ].join("|");
}

function lerLinhasConfirmadas() {
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
  const elegiveis = matriz.slice(1).filter(
    (linha) =>
      compacto(linha[13]) === "CONCLUIDOCOMEXITO" &&
      Number(linha[18]) === 0 &&
      Number(linha[57]) === -1,
  );

  const placasPorChassi = new Map<string, Set<string>>();
  const quantidadePorAssinatura = new Map<string, number>();
  for (const linha of elegiveis) {
    const placa = compacto(linha[26]);
    const chassi = compacto(linha[35]);
    if (placa && chassi) {
      if (!placasPorChassi.has(chassi)) placasPorChassi.set(chassi, new Set());
      placasPorChassi.get(chassi)!.add(placa);
    }
    const assinatura = assinaturaNatural(linha);
    quantidadePorAssinatura.set(assinatura, (quantidadePorAssinatura.get(assinatura) ?? 0) + 1);
  }

  const confirmadas = elegiveis.filter((linha) => PLACAS_ESPERADAS.has(compacto(linha[26])));
  if (confirmadas.length !== QUANTIDADE_TOTAL) {
    throw new Error(`A fonte retornou ${confirmadas.length} OS; esperado: ${QUANTIDADE_TOTAL}.`);
  }

  for (const [placa, quantidade] of PLACAS_ESPERADAS) {
    const linhas = confirmadas.filter((linha) => compacto(linha[26]) === placa);
    const chassis = valores(linhas, (linha) => compacto(linha[35]));
    if (linhas.length !== quantidade) throw new Error(`Quantidade divergente para ${placa}.`);
    if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) throw new Error(`Placa invalida: ${placa}.`);
    if (chassis.size !== 1) throw new Error(`Chassi ambiguo para ${placa}.`);
    if ((placasPorChassi.get([...chassis][0])?.size ?? 0) !== 1) throw new Error(`Chassi reutilizado para ${placa}.`);
    if (valores(linhas, (linha) => documento(linha[15])).size <= 1) throw new Error(`Sem troca de titular em ${placa}.`);
    if (valores(linhas, (linha) => compacto(linha[23])).size > 1) throw new Error(`Marca divergente em ${placa}.`);
    if (valores(linhas, (linha) => compacto(linha[24])).size > 1) throw new Error(`Modelo divergente em ${placa}.`);
    if (valores(linhas, (linha) => ano(linha[25])).size > 1) throw new Error(`Ano divergente em ${placa}.`);
    if (valores(linhas, (linha) => ano(linha[59])).size > 1) throw new Error(`Ano/modelo divergente em ${placa}.`);
    if (linhas.some((linha) => quantidadePorAssinatura.get(assinaturaNatural(linha)) !== 1)) {
      throw new Error(`Registro natural duplicado em ${placa}.`);
    }
  }

  const registros = confirmadas.map((linha) => Number(linha[0]));
  if (registros.some((registro) => !Number.isInteger(registro)) || new Set(registros).size !== QUANTIDADE_TOTAL) {
    throw new Error("Referencias legadas invalidas ou duplicadas.");
  }
  return confirmadas.sort((a, b) => Number(a[0]) - Number(b[0]));
}

function snapshotVeiculo(linha: Linha) {
  const renavamDigitos = texto(linha[27]).replace(/\D/g, "");
  return {
    placa: compacto(linha[26]),
    marca: texto(linha[23]) || null,
    modelo: texto(linha[24]) || null,
    ano_fabricacao: ano(linha[25]),
    ano_modelo: ano(linha[59]),
    chassi: compacto(linha[35]) || null,
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
  ].filter(Boolean).join("\n");
}

async function validarCarga(
  client: Awaited<ReturnType<typeof connectDatabase>>["client"],
  linhas: LinhaInsercao[],
) {
  const referencias = linhas.map((linha) => linha.migracao_referencia);
  const esperadas = new Map(linhas.map((linha) => [linha.migracao_referencia, linha]));
  const ordens = await client.query<{
    id: number;
    migracao_referencia: string;
    clienteid: number;
    veiculoid: number | null;
    status: string;
    dataentrada: string;
    datasaida: string;
    pagamento_concluido_em: string;
    finalizado_em: string;
    orcamentototal: string | number | null;
    subtotal: string | number | null;
    valor_frete: string | number | null;
    placa: string;
    chassi: string | null;
  }>(
    `select id, migracao_referencia, clienteid, veiculoid, status::text,
            dataentrada, datasaida, pagamento_concluido_em, finalizado_em,
            orcamentototal, subtotal, valor_frete,
            veiculo_snapshot ->> 'placa' placa,
            veiculo_snapshot ->> 'chassi' chassi
       from public.ordemservico
      where migracao_referencia = any($1::text[])`,
    [referencias],
  );
  if (ordens.rowCount !== QUANTIDADE_TOTAL) throw new Error(`Auditoria encontrou ${ordens.rowCount} OS.`);

  for (const ordem of ordens.rows) {
    const esperada = esperadas.get(ordem.migracao_referencia);
    if (!esperada) throw new Error(`Referencia inesperada: ${ordem.migracao_referencia}.`);
    const dataEsperada = new Date(esperada.dataentrada).getTime();
    if (
      ordem.clienteid !== esperada.clienteid ||
      ordem.veiculoid !== null ||
      ordem.status !== "CONCLUIDO" ||
      new Date(ordem.dataentrada).getTime() !== dataEsperada ||
      new Date(ordem.datasaida).getTime() !== dataEsperada ||
      new Date(ordem.pagamento_concluido_em).getTime() !== dataEsperada ||
      new Date(ordem.finalizado_em).getTime() !== dataEsperada ||
      Number(ordem.orcamentototal ?? 0) !== 0 ||
      Number(ordem.subtotal ?? 0) !== 0 ||
      Number(ordem.valor_frete ?? 0) !== 0 ||
      ordem.placa !== esperada.veiculo_snapshot.placa ||
      ordem.chassi !== esperada.veiculo_snapshot.chassi
    ) {
      throw new Error(`OS inconsistente: ${ordem.migracao_referencia}.`);
    }
  }

  const efeitos = await client.query<{
    saidas: number;
    saidas_inconsistentes: number;
    efeitos: number;
  }>(
    `select
       (select count(*)::int from public.os_saida s join public.ordemservico o on o.id=s.ordemservico_id where o.migracao_referencia=any($1::text[])) saidas,
       (select count(*)::int from public.os_saida s join public.ordemservico o on o.id=s.ordemservico_id where o.migracao_referencia=any($1::text[]) and s.saida_em is distinct from o.dataentrada) saidas_inconsistentes,
       (select count(*)::int from public.transacao t join public.ordemservico o on o.id=t.ordemservicoid where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.pagamento p join public.ordemservico o on o.id=p.ordemservicoid where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.eventos_financeiros e join public.ordemservico o on o.id=e.ordemservicoid where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.os_notificacao_evento n join public.ordemservico o on o.id=n.ordemservico_id where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.osproduto p join public.ordemservico o on o.id=p.ordemservicoid where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.osservico s join public.ordemservico o on o.id=s.ordemservicoid where o.migracao_referencia=any($1::text[])) efeitos`,
    [referencias],
  );
  const validacao = efeitos.rows[0];
  if (validacao.saidas !== QUANTIDADE_TOTAL || validacao.saidas_inconsistentes !== 0 || validacao.efeitos !== 0) {
    throw new Error(`Efeitos indevidos na carga: ${JSON.stringify(validacao)}.`);
  }
  return ordens.rows.map((ordem) => ordem.id).sort((a, b) => a - b);
}

async function main() {
  const confirmadas = lerLinhasConfirmadas();
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");

  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - trocas de titularidade confirmadas`);
  const { client } = await connectDatabase(configuracao);
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${PREFIXO}TROCA_TITULARIDADE`]);

    const clientesRes = await client.query<ClienteBanco>(
      `select id, cpfcnpj, nomerazaosocial from public.cliente where coalesce(is_deleted, false) = false`,
    );
    const clientesPorDocumento = new Map<string, ClienteBanco[]>();
    for (const cliente of clientesRes.rows) {
      const chave = documento(cliente.cpfcnpj);
      if (!clientesPorDocumento.has(chave)) clientesPorDocumento.set(chave, []);
      clientesPorDocumento.get(chave)!.push(cliente);
    }

    const linhasInsercao: LinhaInsercao[] = confirmadas.map((linha) => {
      const candidatos = clientesPorDocumento.get(documento(linha[15])) ?? [];
      if (candidatos.length !== 1 || compacto(candidatos[0].nomerazaosocial) !== compacto(linha[1])) {
        throw new Error(`Cliente nao confirmado no registro legado ${texto(linha[0])}.`);
      }
      const data = dataIso(linha[4]);
      if (!data) throw new Error(`Data invalida no registro legado ${texto(linha[0])}.`);
      return {
        clienteid: candidatos[0].id,
        descricao: texto(linha[28]) || `Ordem de servico historica #${texto(linha[0])}`,
        dataentrada: meiaNoiteBrasil(data),
        observacoes: observacoes(linha),
        createdat: meiaNoiteBrasil(data),
        updatedat: meiaNoiteBrasil(data),
        migracao_referencia: `${PREFIXO}${texto(linha[0])}`,
        veiculo_snapshot: snapshotVeiculo(linha),
      };
    });

    const placas = [...PLACAS_ESPERADAS.keys()];
    const chassis = [
      ...new Set(
        linhasInsercao
          .map((linha) => linha.veiculo_snapshot.chassi)
          .filter((chassi): chassi is string => typeof chassi === "string" && chassi.length > 0),
      ),
    ];
    const veiculos = await client.query(
      `select id from public.veiculo
        where regexp_replace(upper(coalesce(placa, '')), '[^A-Z0-9]', '', 'g') = any($1::text[])
           or regexp_replace(upper(coalesce(chassi, '')), '[^A-Z0-9]', '', 'g') = any($2::text[])`,
      [placas, chassis],
    );
    if (veiculos.rowCount) {
      throw new Error(
        `${veiculos.rowCount} veiculos agora conflitam com a carga: ${JSON.stringify(veiculos.rows)}.`,
      );
    }

    const referencias = linhasInsercao.map((linha) => linha.migracao_referencia);
    const existentes = await client.query(
      `select migracao_referencia from public.ordemservico where migracao_referencia = any($1::text[])`,
      [referencias],
    );
    if (existentes.rowCount === QUANTIDADE_TOTAL) {
      const ids = await validarCarga(client, linhasInsercao);
      console.log(`Carga ja aplicada e auditada: ${ids.length} OS.`);
      await client.query("ROLLBACK");
      return;
    }
    if (existentes.rowCount) throw new Error(`Carga parcial encontrada: ${existentes.rowCount} de ${QUANTIDADE_TOTAL} OS.`);

    const criadorRes = await client.query<{ id: string; nome: string }>(
      `select id, nome from public.usuario where lower(email) = lower($1) and ativo = true`,
      [CRIADOR_EMAIL],
    );
    if (criadorRes.rowCount !== 1) throw new Error(`Usuario tecnico nao encontrado: ${CRIADOR_EMAIL}`);
    const setorRes = await client.query(`select id from public.setor where id = $1`, [SETOR_ID]);
    if (setorRes.rowCount !== 1) throw new Error(`Setor da migracao nao encontrado: ${SETOR_ID}`);

    console.log(`Candidatas validadas: ${QUANTIDADE_TOTAL} OS em ${PLACAS_ESPERADAS.size} placas.`);
    if (!APLICAR) {
      console.log("Simulacao concluida sem INSERT; a sequencia de IDs foi preservada.");
      await client.query("ROLLBACK");
      return;
    }

    const antes = await client.query<{ clientes: number; veiculos: number }>(
      `select (select count(*)::int from public.cliente) clientes,
              (select count(*)::int from public.veiculo) veiculos`,
    );
    const insercao = await client.query(
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
       )`,
      [JSON.stringify(linhasInsercao), criadorRes.rows[0].id, SETOR_ID],
    );
    if (insercao.rowCount !== QUANTIDADE_TOTAL) throw new Error(`Foram inseridas ${insercao.rowCount} OS.`);

    const saidas = await client.query(
      `insert into public.os_saida (
         ordemservico_id, saida_em, retirado_por, documento_observacao,
         registrado_por, created_by, created_at, updated_at
       )
       select os.id, os.dataentrada, 'Registro historico migrado',
              'Saida registrada a partir do historico do sistema legado.',
              coalesce(os.usuariocriadorid, os.created_by),
              coalesce(os.created_by, os.usuariocriadorid), os.dataentrada, os.dataentrada
         from public.ordemservico os
        where os.migracao_referencia = any($1::text[])
       on conflict (ordemservico_id) do nothing`,
      [referencias],
    );
    if (saidas.rowCount !== QUANTIDADE_TOTAL) throw new Error(`Foram inseridas ${saidas.rowCount} saidas.`);

    const ids = await validarCarga(client, linhasInsercao);
    const depois = await client.query<{ clientes: number; veiculos: number }>(
      `select (select count(*)::int from public.cliente) clientes,
              (select count(*)::int from public.veiculo) veiculos`,
    );
    if (
      depois.rows[0].clientes !== antes.rows[0].clientes ||
      depois.rows[0].veiculos !== antes.rows[0].veiculos
    ) {
      throw new Error("A carga alterou a quantidade de clientes ou veiculos.");
    }

    await client.query("COMMIT");
    console.log(`Carga confirmada: ${ids.length} OS, IDs ${ids[0]} a ${ids.at(-1)}.`);
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
