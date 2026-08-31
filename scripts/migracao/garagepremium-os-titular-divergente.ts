/**
 * Migra 30 OS em que o cliente confirmado na origem difere do proprietario
 * atual do veiculo. Vincula ambos na OS e nao altera nenhum cadastro.
 *
 * Uso:
 *   npm run migracao:garage:os-titular-divergente
 *   npm run migracao:garage:os-titular-divergente -- --aplicar
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const APLICAR = process.argv.includes("--aplicar");
const DIRETORIO = path.join(projectRoot, "docs", "migracao_garagepremium");
const FONTE = fs.readdirSync(DIRETORIO).find((nome) => nome.startsWith("EXPORT") && nome.endsWith("OS.xlsx"));
if (!FONTE) throw new Error("Planilha de exportacao das OS nao encontrada.");
const ARQUIVO = path.join(DIRETORIO, FONTE);
const HASH_ESPERADO = "1526E77348871B041ED3B8D1FC6F954C1EDDFCC535188C51AADA7CA1E6E51903";
const PREFIXO = "LEGADO_OS_EXPORTACAO:";
const CRIADOR_EMAIL = "brunolima@figosoftwares.com.br";
const SETOR_ID = 1;
const REGISTROS = new Set([
  35, 91, 285, 508, 596, 1744, 1809, 1986, 2213, 2263,
  2417, 2427, 2570, 2651, 2938, 2996, 3056, 3154, 3158, 3311,
  3385, 3637, 3761, 3810, 3824, 3882, 4020, 4486, 4502, 4556,
]);
const TOTAL = 30;

type Linha = unknown[];
type Cliente = { id: number; cpfcnpj: string; nomerazaosocial: string };
type Veiculo = {
  id: number;
  clienteid: number | null;
  placa: string;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  ano_modelo: number | null;
  chassi: string | null;
  cor: string | null;
  combustivel: string | null;
};
type Insercao = {
  clienteid: number;
  veiculoid: number;
  descricao: string;
  dataentrada: string;
  observacoes: string;
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
  const valorDigitos = texto(valor).replace(/\D/g, "");
  if (!valorDigitos) return "";
  return valorDigitos.length <= 11 ? valorDigitos.padStart(11, "0") : valorDigitos.padStart(14, "0");
}

function inteiroPositivo(valor: unknown) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? Math.trunc(numero) : null;
}

function dataIso(valor: unknown) {
  if (typeof valor !== "number") return null;
  const partes = XLSX.SSF.parse_date_code(valor);
  if (!partes) return null;
  return `${partes.y}-${String(partes.m).padStart(2, "0")}-${String(partes.d).padStart(2, "0")}T00:00:00-03:00`;
}

function adicionar<K, V>(mapa: Map<K, V[]>, chave: K, valor: V) {
  const lista = mapa.get(chave) ?? [];
  lista.push(valor);
  mapa.set(chave, lista);
}

function lerLinhas() {
  if (REGISTROS.size !== TOTAL) throw new Error("Lista de registros divergente.");
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
  const linhas = matriz.slice(1).filter((linha) => REGISTROS.has(Number(linha[0])));
  if (linhas.length !== TOTAL) throw new Error(`A fonte retornou ${linhas.length} OS; esperado: ${TOTAL}.`);
  for (const linha of linhas) {
    const registro = Number(linha[0]);
    const placa = compacto(linha[26]);
    if (
      compacto(linha[13]) !== "CONCLUIDOCOMEXITO" ||
      Number(linha[18]) !== 0 ||
      Number(linha[57]) !== -1 ||
      !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)
    ) {
      throw new Error(`Registro legado ${registro} nao atende aos criterios aprovados.`);
    }
  }
  return linhas.sort((a, b) => Number(a[0]) - Number(b[0]));
}

function snapshot(veiculo: Veiculo, linha: Linha) {
  return {
    placa: compacto(veiculo.placa),
    marca: veiculo.marca,
    modelo: veiculo.modelo,
    ano_fabricacao: veiculo.ano,
    ano_modelo: veiculo.ano_modelo,
    chassi: compacto(veiculo.chassi) || null,
    renavam: null,
    cor: veiculo.cor,
    combustivel: veiculo.combustivel,
    km: inteiroPositivo(linha[30]),
    descricao_veiculo: null,
  };
}

function observacoes(linha: Linha) {
  return [
    texto(linha[5]) ? `Observacao da OS: ${texto(linha[5])}` : null,
    texto(linha[29]) ? `Observacoes gerais: ${texto(linha[29])}` : null,
    inteiroPositivo(linha[30]) != null ? `Quilometragem informada: ${inteiroPositivo(linha[30])} km` : null,
    texto(linha[6]) ? `Vendedor no sistema anterior: ${texto(linha[6])}` : null,
    "Cliente da OS confirmado pela origem; proprietario atual do veiculo preservado sem alteracoes.",
    "Dados do veiculo na OS obtidos do cadastro atual pela placa.",
    `Registro legado: ${texto(linha[0])}`,
  ].filter(Boolean).join("\n");
}

async function auditar(
  client: Awaited<ReturnType<typeof connectDatabase>>["client"],
  linhas: Insercao[],
) {
  const referencias = linhas.map((linha) => linha.migracao_referencia);
  const esperadas = new Map(linhas.map((linha) => [linha.migracao_referencia, linha]));
  const ordens = await client.query<{
    id: number;
    migracao_referencia: string;
    clienteid: number;
    veiculoid: number;
    status: string;
    dataentrada: string;
    datasaida: string;
    pagamento_concluido_em: string;
    finalizado_em: string;
    orcamentototal: string | number | null;
    subtotal: string | number | null;
    valor_frete: string | number | null;
    placa: string;
  }>(
    `select id, migracao_referencia, clienteid, veiculoid, status::text,
            dataentrada, datasaida, pagamento_concluido_em, finalizado_em,
            orcamentototal, subtotal, valor_frete, veiculo_snapshot ->> 'placa' placa
       from public.ordemservico
      where migracao_referencia = any($1::text[])`,
    [referencias],
  );
  if (ordens.rowCount !== TOTAL) throw new Error(`Auditoria encontrou ${ordens.rowCount} OS.`);
  for (const ordem of ordens.rows) {
    const esperada = esperadas.get(ordem.migracao_referencia);
    if (!esperada) throw new Error(`Referencia inesperada: ${ordem.migracao_referencia}.`);
    const data = new Date(esperada.dataentrada).getTime();
    if (
      ordem.clienteid !== esperada.clienteid ||
      ordem.veiculoid !== esperada.veiculoid ||
      ordem.status !== "CONCLUIDO" ||
      ordem.placa !== esperada.veiculo_snapshot.placa ||
      new Date(ordem.dataentrada).getTime() !== data ||
      new Date(ordem.datasaida).getTime() !== data ||
      new Date(ordem.pagamento_concluido_em).getTime() !== data ||
      new Date(ordem.finalizado_em).getTime() !== data ||
      Number(ordem.orcamentototal ?? 0) !== 0 ||
      Number(ordem.subtotal ?? 0) !== 0 ||
      Number(ordem.valor_frete ?? 0) !== 0
    ) {
      throw new Error(`OS inconsistente: ${ordem.migracao_referencia}.`);
    }
  }
  const efeitos = await client.query<{ saidas: number; saidas_erradas: number; efeitos: number }>(
    `select
       (select count(*)::int from public.os_saida s join public.ordemservico o on o.id=s.ordemservico_id where o.migracao_referencia=any($1::text[])) saidas,
       (select count(*)::int from public.os_saida s join public.ordemservico o on o.id=s.ordemservico_id where o.migracao_referencia=any($1::text[]) and s.saida_em is distinct from o.dataentrada) saidas_erradas,
       (select count(*)::int from public.transacao t join public.ordemservico o on o.id=t.ordemservicoid where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.pagamento p join public.ordemservico o on o.id=p.ordemservicoid where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.eventos_financeiros e join public.ordemservico o on o.id=e.ordemservicoid where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.os_notificacao_evento n join public.ordemservico o on o.id=n.ordemservico_id where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.osproduto p join public.ordemservico o on o.id=p.ordemservicoid where o.migracao_referencia=any($1::text[]))
         + (select count(*)::int from public.osservico s join public.ordemservico o on o.id=s.ordemservicoid where o.migracao_referencia=any($1::text[])) efeitos`,
    [referencias],
  );
  const resultado = efeitos.rows[0];
  if (resultado.saidas !== TOTAL || resultado.saidas_erradas !== 0 || resultado.efeitos !== 0) {
    throw new Error(`Efeitos indevidos: ${JSON.stringify(resultado)}.`);
  }
  return ordens.rows.map((ordem) => ordem.id).sort((a, b) => a - b);
}

async function main() {
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");
  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - titular do veiculo divergente`);
  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${PREFIXO}TITULAR_DIVERGENTE`]);

    const clientesRes = await client.query<Cliente>(
      "select id, cpfcnpj, nomerazaosocial from public.cliente where coalesce(is_deleted, false) = false",
    );
    const veiculosRes = await client.query<Veiculo>(
      `select id, clienteid, placa, marca, modelo, ano, ano_modelo, chassi, cor, combustivel from public.veiculo`,
    );
    const clientesPorDocumento = new Map<string, Cliente[]>();
    const veiculosPorPlaca = new Map<string, Veiculo[]>();
    for (const cliente of clientesRes.rows) adicionar(clientesPorDocumento, documento(cliente.cpfcnpj), cliente);
    for (const veiculo of veiculosRes.rows) adicionar(veiculosPorPlaca, compacto(veiculo.placa), veiculo);

    const linhasInsercao: Insercao[] = lerLinhas().map((linha) => {
      const registro = Number(linha[0]);
      const clientes = (clientesPorDocumento.get(documento(linha[15])) ?? []).filter(
        (cliente) => compacto(cliente.nomerazaosocial) === compacto(linha[1]),
      );
      if (clientes.length !== 1) throw new Error(`Cliente ambiguo no registro ${registro}.`);
      const veiculos = veiculosPorPlaca.get(compacto(linha[26])) ?? [];
      if (veiculos.length !== 1) throw new Error(`Veiculo ambiguo no registro ${registro}.`);
      const veiculo = veiculos[0];
      if (veiculo.clienteid === clientes[0].id) throw new Error(`Titular deixou de divergir no registro ${registro}.`);
      const data = dataIso(linha[4]);
      if (!data) throw new Error(`Data invalida no registro ${registro}.`);
      return {
        clienteid: clientes[0].id,
        veiculoid: veiculo.id,
        descricao: texto(linha[28]) || `Ordem de servico historica #${registro}`,
        dataentrada: data,
        observacoes: observacoes(linha),
        migracao_referencia: `${PREFIXO}${registro}`,
        veiculo_snapshot: snapshot(veiculo, linha),
      };
    });

    const referencias = linhasInsercao.map((linha) => linha.migracao_referencia);
    const existentes = await client.query(
      "select migracao_referencia from public.ordemservico where migracao_referencia = any($1::text[])",
      [referencias],
    );
    if (existentes.rowCount === TOTAL) {
      const ids = await auditar(client, linhasInsercao);
      console.log(`Carga ja aplicada e auditada: ${ids.length} OS.`);
      await client.query("ROLLBACK");
      return;
    }
    if (existentes.rowCount) throw new Error(`Carga parcial encontrada: ${existentes.rowCount} de ${TOTAL}.`);

    const criador = await client.query<{ id: string }>(
      "select id from public.usuario where lower(email)=lower($1) and ativo=true",
      [CRIADOR_EMAIL],
    );
    if (criador.rowCount !== 1) throw new Error(`Usuario tecnico nao encontrado: ${CRIADOR_EMAIL}.`);
    const setor = await client.query("select id from public.setor where id=$1", [SETOR_ID]);
    if (setor.rowCount !== 1) throw new Error(`Setor nao encontrado: ${SETOR_ID}.`);

    console.log(`Candidatas validadas: ${TOTAL} OS, todas vinculadas a cliente e veiculo.`);
    if (!APLICAR) {
      console.log("Simulacao concluida sem INSERT; sequencia de IDs preservada.");
      await client.query("ROLLBACK");
      return;
    }

    const antes = await client.query<{ clientes: number; veiculos: number }>(
      "select (select count(*)::int from public.cliente) clientes, (select count(*)::int from public.veiculo) veiculos",
    );
    const insercao = await client.query(
      `insert into public.ordemservico (
         clienteid, veiculoid, usuariocriadorid, setorid, status, statusaprovacao,
         descricao, dataentrada, datasaida, orcamentototal, valor_frete, subtotal,
         observacoes, createdat, updatedat, prioridade, alvo_tipo, created_by,
         updated_by, is_deleted, pagamento_concluido_em, finalizado_em,
         forma_pagamento, parcelas_pagamento, pagamentos_previstos,
         migracao_referencia, veiculo_snapshot
       )
       select x.clienteid, x.veiculoid, $2::uuid, $3::integer,
              'CONCLUIDO'::public.enum_status_os, 'APROVADA'::public.enum_status_aprovacao,
              x.descricao, x.dataentrada::timestamptz, x.dataentrada::timestamptz, 0, 0, 0,
              x.observacoes, x.dataentrada::timestamptz, x.dataentrada::timestamptz,
              'NORMAL'::public.enum_prioridade_os, 'VEICULO'::public.enum_alvo_reparo,
              $2::uuid, $2::uuid, false, x.dataentrada::timestamptz, x.dataentrada::timestamptz,
              null, null, null, x.migracao_referencia, x.veiculo_snapshot
         from jsonb_to_recordset($1::jsonb) as x(
           clienteid integer, veiculoid integer, descricao text, dataentrada text,
           observacoes text, migracao_referencia text, veiculo_snapshot jsonb
         )`,
      [JSON.stringify(linhasInsercao), criador.rows[0].id, SETOR_ID],
    );
    if (insercao.rowCount !== TOTAL) throw new Error(`Foram inseridas ${insercao.rowCount} OS.`);

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
        where os.migracao_referencia=any($1::text[])
       on conflict (ordemservico_id) do nothing`,
      [referencias],
    );
    if (saidas.rowCount !== TOTAL) throw new Error(`Foram inseridas ${saidas.rowCount} saidas.`);

    const ids = await auditar(client, linhasInsercao);
    const depois = await client.query<{ clientes: number; veiculos: number }>(
      "select (select count(*)::int from public.cliente) clientes, (select count(*)::int from public.veiculo) veiculos",
    );
    if (JSON.stringify(antes.rows[0]) !== JSON.stringify(depois.rows[0])) {
      throw new Error("A carga alterou a quantidade de clientes ou veiculos.");
    }
    await client.query("COMMIT");
    console.log(`Carga confirmada: ${ids.length} OS, IDs ${ids[0]} a ${ids.at(-1)}.`);
    console.log("Proprietarios preservados. Efeitos financeiros, notificacoes e itens: 0.");
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

