/**
 * Migra OS historicas cujo veiculo e titular ja existem no Garage Premium,
 * usando o chassi correto do cadastro em vez da divergencia da planilha.
 *
 * Uso:
 *   npm run migracao:garage:os-chassi-cadastrado
 *   npm run migracao:garage:os-chassi-cadastrado -- --aplicar
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

const CASOS = new Map([
  ["CSP7A74", { quantidade: 7, veiculoId: 10, chassiFonte: "W2806108", chassiBanco: "8B4FJB8SCW2806106" }],
  ["EAL0A83", { quantidade: 14, veiculoId: 33, chassiFonte: "WDCBF8W7AA601282", chassiBanco: "WDCBF8GW7AA601282" }],
  ["OGF0286", { quantidade: 18, veiculoId: 6, chassiFonte: "SALLAAAG6DA394196", chassiBanco: "SALLAAAG6DA694196" }],
  ["QFY5F48", { quantidade: 1, veiculoId: 47, chassiFonte: "8AJBA3FS9N0228217", chassiBanco: "8AJBA3FS9H0228217" }],
]);
const QUANTIDADE_TOTAL = [...CASOS.values()].reduce((soma, caso) => soma + caso.quantidade, 0);
if (QUANTIDADE_TOTAL !== 40) throw new Error("A lista confirmada deveria conter 40 OS.");

type Linha = unknown[];
type VeiculoBanco = {
  id: number;
  clienteid: number;
  placa: string;
  chassi: string | null;
  ano: number | null;
  ano_modelo: number | null;
  marca: string | null;
  modelo: string | null;
  cor: string | null;
  combustivel: string | null;
  kmatual: number | null;
  nomerazaosocial: string;
  cpfcnpj: string;
};
type LinhaInsercao = {
  clienteid: number;
  veiculoid: number;
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

function lerLinhas() {
  const conteudo = fs.readFileSync(ARQUIVO);
  const hash = crypto.createHash("sha256").update(conteudo).digest("hex").toUpperCase();
  if (hash !== HASH_ESPERADO) throw new Error(`A planilha mudou. SHA-256 atual: ${hash}`);

  const workbook = XLSX.read(conteudo);
  const aba = workbook.SheetNames[0];
  if (!aba) throw new Error("A planilha nao possui abas.");
  const matriz = XLSX.utils.sheet_to_json<Linha>(workbook.Sheets[aba], {
    header: 1,
    defval: null,
    raw: true,
  });
  const linhas = matriz.slice(1).filter(
    (linha) =>
      CASOS.has(compacto(linha[26])) &&
      compacto(linha[13]) === "CONCLUIDOCOMEXITO" &&
      Number(linha[18]) === 0 &&
      Number(linha[57]) === -1,
  );
  if (linhas.length !== QUANTIDADE_TOTAL) {
    throw new Error(`A fonte retornou ${linhas.length} OS; esperado: ${QUANTIDADE_TOTAL}.`);
  }

  for (const [placa, caso] of CASOS) {
    const grupo = linhas.filter((linha) => compacto(linha[26]) === placa);
    if (grupo.length !== caso.quantidade) throw new Error(`Quantidade divergente para ${placa}.`);
    const chassis = valores(grupo, (linha) => compacto(linha[35]));
    if (chassis.size !== 1 || [...chassis][0] !== caso.chassiFonte) {
      throw new Error(`Chassi legado divergente para ${placa}.`);
    }
    if (valores(grupo, (linha) => documento(linha[15])).size !== 1) {
      throw new Error(`Cliente ambiguo para ${placa}.`);
    }
  }
  const registros = linhas.map((linha) => Number(linha[0]));
  if (new Set(registros).size !== QUANTIDADE_TOTAL) throw new Error("Referencias legadas duplicadas.");
  return linhas.sort((a, b) => Number(a[0]) - Number(b[0]));
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

function snapshotDoCadastro(veiculo: VeiculoBanco, linha: Linha) {
  return {
    placa: compacto(veiculo.placa),
    marca: veiculo.marca,
    modelo: veiculo.modelo,
    ano_fabricacao: veiculo.ano,
    ano_modelo: veiculo.ano_modelo,
    chassi: compacto(veiculo.chassi),
    renavam: null,
    cor: veiculo.cor,
    combustivel: veiculo.combustivel,
    km: inteiroPositivo(linha[30]),
    descricao_veiculo: null,
  };
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
    placa: string;
    chassi: string;
  }>(
    `select id, migracao_referencia, clienteid, veiculoid, status::text,
            dataentrada, datasaida, pagamento_concluido_em, finalizado_em,
            veiculo_snapshot ->> 'placa' placa, veiculo_snapshot ->> 'chassi' chassi
       from public.ordemservico
      where migracao_referencia = any($1::text[])`,
    [referencias],
  );
  if (ordens.rowCount !== QUANTIDADE_TOTAL) throw new Error(`Auditoria encontrou ${ordens.rowCount} OS.`);
  for (const ordem of ordens.rows) {
    const esperada = esperadas.get(ordem.migracao_referencia);
    if (!esperada) throw new Error(`Referencia inesperada: ${ordem.migracao_referencia}.`);
    const data = new Date(esperada.dataentrada).getTime();
    if (
      ordem.clienteid !== esperada.clienteid ||
      ordem.veiculoid !== esperada.veiculoid ||
      ordem.status !== "CONCLUIDO" ||
      new Date(ordem.dataentrada).getTime() !== data ||
      new Date(ordem.datasaida).getTime() !== data ||
      new Date(ordem.pagamento_concluido_em).getTime() !== data ||
      new Date(ordem.finalizado_em).getTime() !== data ||
      ordem.placa !== esperada.veiculo_snapshot.placa ||
      ordem.chassi !== esperada.veiculo_snapshot.chassi
    ) {
      throw new Error(`OS inconsistente: ${ordem.migracao_referencia}.`);
    }
  }

  const efeitos = await client.query<{ saidas: number; saidas_inconsistentes: number; efeitos: number }>(
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
    throw new Error(`Efeitos indevidos: ${JSON.stringify(validacao)}.`);
  }
  return ordens.rows.map((ordem) => ordem.id).sort((a, b) => a - b);
}

async function main() {
  const linhas = lerLinhas();
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");
  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - veiculos com chassi cadastrado confirmado`);

  const { client } = await connectDatabase(configuracao);
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${PREFIXO}CHASSI_CADASTRADO`]);

    const veiculosRes = await client.query<VeiculoBanco>(
      `select v.id, v.clienteid, v.placa, v.chassi, v.ano, v.ano_modelo,
              v.marca, v.modelo, v.cor, v.combustivel, v.kmatual,
              c.nomerazaosocial, c.cpfcnpj
         from public.veiculo v
         join public.cliente c on c.id = v.clienteid
        where v.id = any($1::int[])`,
      [[...CASOS.values()].map((caso) => caso.veiculoId)],
    );
    if (veiculosRes.rowCount !== CASOS.size) throw new Error("Nem todos os veiculos confirmados existem.");
    const veiculosPorPlaca = new Map(veiculosRes.rows.map((veiculo) => [compacto(veiculo.placa), veiculo]));

    const linhasInsercao: LinhaInsercao[] = linhas.map((linha) => {
      const placa = compacto(linha[26]);
      const caso = CASOS.get(placa)!;
      const veiculo = veiculosPorPlaca.get(placa);
      if (
        !veiculo ||
        veiculo.id !== caso.veiculoId ||
        compacto(veiculo.chassi) !== caso.chassiBanco ||
        documento(veiculo.cpfcnpj) !== documento(linha[15]) ||
        compacto(veiculo.nomerazaosocial) !== compacto(linha[1])
      ) {
        throw new Error(`Veiculo, chassi ou titular divergente para ${placa}.`);
      }
      const anosFonte = ano(linha[25]);
      const anoModeloFonte = ano(linha[59]);
      if (
        (anosFonte != null && anosFonte !== veiculo.ano) ||
        (anoModeloFonte != null && anoModeloFonte !== veiculo.ano_modelo)
      ) {
        throw new Error(`Ano divergente para ${placa}.`);
      }
      const data = dataIso(linha[4]);
      if (!data) throw new Error(`Data invalida no registro legado ${texto(linha[0])}.`);
      return {
        clienteid: veiculo.clienteid,
        veiculoid: veiculo.id,
        descricao: texto(linha[28]) || `Ordem de servico historica #${texto(linha[0])}`,
        dataentrada: meiaNoiteBrasil(data),
        observacoes: observacoes(linha),
        createdat: meiaNoiteBrasil(data),
        updatedat: meiaNoiteBrasil(data),
        migracao_referencia: `${PREFIXO}${texto(linha[0])}`,
        veiculo_snapshot: snapshotDoCadastro(veiculo, linha),
      };
    });

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

    const criadorRes = await client.query<{ id: string }>(
      `select id from public.usuario where lower(email) = lower($1) and ativo = true`,
      [CRIADOR_EMAIL],
    );
    if (criadorRes.rowCount !== 1) throw new Error(`Usuario tecnico nao encontrado: ${CRIADOR_EMAIL}`);
    const setorRes = await client.query(`select id from public.setor where id = $1`, [SETOR_ID]);
    if (setorRes.rowCount !== 1) throw new Error(`Setor da migracao nao encontrado: ${SETOR_ID}`);

    console.log(`Candidatas validadas: ${QUANTIDADE_TOTAL} OS vinculadas a ${CASOS.size} veiculos.`);
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
       select x.clienteid, x.veiculoid, $2::uuid, $3::integer,
              'CONCLUIDO'::public.enum_status_os, 'APROVADA'::public.enum_status_aprovacao,
              x.descricao, x.dataentrada::timestamptz, x.dataentrada::timestamptz, 0, 0, 0,
              x.observacoes, x.createdat::timestamptz, x.updatedat::timestamptz,
              'NORMAL'::public.enum_prioridade_os, 'VEICULO'::public.enum_alvo_reparo,
              $2::uuid, $2::uuid, false, x.dataentrada::timestamptz, x.dataentrada::timestamptz,
              null, null, null, x.migracao_referencia, x.veiculo_snapshot
         from jsonb_to_recordset($1::jsonb) as x(
           clienteid integer, veiculoid integer, descricao text, dataentrada text,
           observacoes text, createdat text, updatedat text,
           migracao_referencia text, veiculo_snapshot jsonb
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
    console.log("Cadastros preservados. Efeitos financeiros e notificacoes: 0.");
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
