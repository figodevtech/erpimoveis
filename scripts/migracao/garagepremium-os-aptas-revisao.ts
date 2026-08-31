/**
 * Migra as 40 OS aprovadas a partir da planilha de pendencias. A selecao e
 * congelada por registro legado e nunca cria ou altera clientes e veiculos.
 *
 * Uso:
 *   npm run migracao:garage:os-aptas-revisao
 *   npm run migracao:garage:os-aptas-revisao -- --aplicar
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const ARGUMENTOS = new Set(process.argv.slice(2));
const APLICAR = ARGUMENTOS.has("--aplicar");
const LOTE_CADASTRO_ATUAL = ARGUMENTOS.has("--cadastro-atual");
const DIRETORIO = path.join(projectRoot, "docs", "migracao_garagepremium");
const FONTE = fs.readdirSync(DIRETORIO).find((nome) => nome.startsWith("EXPORT") && nome.endsWith("OS.xlsx"));
if (!FONTE) throw new Error("Planilha de exportacao das OS nao encontrada.");
const ARQUIVO = path.join(DIRETORIO, FONTE);
const HASH_ESPERADO = "1526E77348871B041ED3B8D1FC6F954C1EDDFCC535188C51AADA7CA1E6E51903";
const PREFIXO = "LEGADO_OS_EXPORTACAO:";
const CRIADOR_EMAIL = "brunolima@figosoftwares.com.br";
const SETOR_ID = 1;
const REGISTROS_REVISAO = new Set([
  179, 1719, 1816, 1963, 1992, 2169, 2343, 2345, 2448, 2599,
  2606, 2666, 2777, 2891, 2895, 2901, 2910, 2941, 2986, 3074,
  3076, 3182, 3238, 3318, 3342, 3399, 3415, 3420, 3581, 3620,
  3708, 3799, 3851, 4016, 4204, 4307, 4352, 4447, 4520, 4541,
]);
const PLACAS_REVISAO = new Map<string, number>([
  ["DIG0671", 10],
  ["NPZ2319", 2],
  ["NQH4811", 6],
  ["OFZ4955", 5],
  ["OSM5D51", 2],
  ["QFG2350", 1],
  ["QFL9923", 5],
  ["QFP0154", 1],
  ["QFS7290", 3],
  ["QSD0312", 5],
]);

const REGISTROS_CADASTRO_ATUAL = new Set([
  30, 1694, 1785, 1859, 2667, 2861, 2919, 2998, 3006, 3021,
  3027, 3031, 3065, 3169, 3236, 3278, 3358, 3540, 3680, 3682,
  3701, 3750, 3785, 3856, 3860, 3887, 3906, 4015, 4056, 4175,
  4239, 4279, 4280, 4289, 4326, 4355, 4389, 4393, 4403, 4431,
  4439, 4482, 4509, 4512, 4534, 4576,
]);
const PLACAS_CADASTRO_ATUAL = new Map<string, number>([
  ["GDT1B05", 2], ["LQR7B42", 2], ["NOB7J26", 7], ["OEZ1J01", 1],
  ["OGC4G22", 3], ["PNY3A00", 2], ["QFA4834", 9], ["QFN9G80", 3],
  ["QFW1A05", 8], ["QRW8I80", 1], ["QSG4207", 2], ["QSH4I09", 1],
  ["QTN6G20", 1], ["RBD5J93", 3], ["ROH3I85", 1],
]);

const REGISTROS = LOTE_CADASTRO_ATUAL ? REGISTROS_CADASTRO_ATUAL : REGISTROS_REVISAO;
const PLACAS_ESPERADAS = LOTE_CADASTRO_ATUAL ? PLACAS_CADASTRO_ATUAL : PLACAS_REVISAO;
const QUANTIDADE_TOTAL = LOTE_CADASTRO_ATUAL ? 46 : 40;
const QUANTIDADE_VINCULADA = LOTE_CADASTRO_ATUAL ? 46 : 2;
const NOME_LOTE = LOTE_CADASTRO_ATUAL ? "dados atuais do veiculo" : "40 OS aprovadas na revisao";
if (REGISTROS.size !== QUANTIDADE_TOTAL) throw new Error("Lista de registros incompleta.");

type Linha = unknown[];
type ClienteBanco = { id: number; cpfcnpj: string; nomerazaosocial: string };
type VeiculoBanco = {
  id: number;
  clienteid: number;
  placa: string;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  ano_modelo: number | null;
  chassi: string | null;
  cor: string | null;
  combustivel: string | null;
};
type LinhaInsercao = {
  clienteid: number;
  veiculoid: number | null;
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

function adicionar<K, V>(mapa: Map<K, V[]>, chave: K, valor: V) {
  const valores = mapa.get(chave) ?? [];
  valores.push(valor);
  mapa.set(chave, valores);
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
  const linhas = matriz.slice(1).filter((linha) => REGISTROS.has(Number(linha[0])));
  if (linhas.length !== QUANTIDADE_TOTAL) {
    throw new Error(`A fonte retornou ${linhas.length} OS; esperado: ${QUANTIDADE_TOTAL}.`);
  }

  const contagemPlacas = new Map<string, number>();
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
    contagemPlacas.set(placa, (contagemPlacas.get(placa) ?? 0) + 1);
  }
  if (
    contagemPlacas.size !== PLACAS_ESPERADAS.size ||
    [...PLACAS_ESPERADAS].some(([placa, quantidade]) => contagemPlacas.get(placa) !== quantidade)
  ) {
    throw new Error("As placas da carga divergiram da planilha revisada.");
  }
  return linhas.sort((a, b) => Number(a[0]) - Number(b[0]));
}

function snapshotFonte(linha: Linha) {
  const renavam = texto(linha[27]).replace(/\D/g, "");
  return {
    placa: compacto(linha[26]),
    marca: texto(linha[23]) || null,
    modelo: texto(linha[24]) || null,
    ano_fabricacao: ano(linha[25]),
    ano_modelo: ano(linha[59]),
    chassi: compacto(linha[35]) || null,
    renavam: renavam ? renavam.padStart(11, "0") : null,
    cor: texto(linha[34]) || null,
    combustivel: texto(linha[36]) || null,
    km: inteiroPositivo(linha[30]),
    descricao_veiculo: texto(linha[33]) || null,
  };
}

function snapshotCadastro(veiculo: VeiculoBanco, linha: Linha) {
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

function observacoes(linha: Linha, veiculo: VeiculoBanco | null) {
  return [
    texto(linha[5]) ? `Observacao da OS: ${texto(linha[5])}` : null,
    texto(linha[29]) ? `Observacoes gerais: ${texto(linha[29])}` : null,
    inteiroPositivo(linha[30]) != null ? `Quilometragem informada: ${inteiroPositivo(linha[30])} km` : null,
    texto(linha[6]) ? `Vendedor no sistema anterior: ${texto(linha[6])}` : null,
    veiculo
      ? "Veiculo vinculado exclusivamente pela placa; cadastro atual preservado."
      : "Dados do veiculo mantidos somente no historico; nenhum cadastro foi criado ou alterado.",
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
    orcamentototal: number | string | null;
    subtotal: number | string | null;
    valor_frete: number | string | null;
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
    const data = new Date(esperada.dataentrada).getTime();
    if (
      ordem.clienteid !== esperada.clienteid ||
      ordem.veiculoid !== esperada.veiculoid ||
      ordem.status !== "CONCLUIDO" ||
      new Date(ordem.dataentrada).getTime() !== data ||
      new Date(ordem.datasaida).getTime() !== data ||
      new Date(ordem.pagamento_concluido_em).getTime() !== data ||
      new Date(ordem.finalizado_em).getTime() !== data ||
      Number(ordem.orcamentototal ?? 0) !== 0 ||
      Number(ordem.subtotal ?? 0) !== 0 ||
      Number(ordem.valor_frete ?? 0) !== 0 ||
      ordem.placa !== esperada.veiculo_snapshot.placa ||
      (ordem.chassi || null) !== (esperada.veiculo_snapshot.chassi || null)
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
  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - ${NOME_LOTE}`);
  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${PREFIXO}${LOTE_CADASTRO_ATUAL ? "CADASTRO_ATUAL" : "APTAS_REVISAO"}`]);

    const clientesRes = await client.query<ClienteBanco>(
      "select id, cpfcnpj, nomerazaosocial from public.cliente where coalesce(is_deleted, false) = false",
    );
    const veiculosRes = await client.query<VeiculoBanco>(
      `select id, clienteid, placa, marca, modelo, ano, ano_modelo, chassi, cor, combustivel
         from public.veiculo`,
    );
    const clientesPorDocumento = new Map<string, ClienteBanco[]>();
    const veiculosPorPlaca = new Map<string, VeiculoBanco[]>();
    for (const cliente of clientesRes.rows) {
      const chave = documento(cliente.cpfcnpj);
      if (chave) adicionar(clientesPorDocumento, chave, cliente);
    }
    for (const veiculo of veiculosRes.rows) {
      const chave = compacto(veiculo.placa);
      if (chave) adicionar(veiculosPorPlaca, chave, veiculo);
    }

    const linhasInsercao: LinhaInsercao[] = linhas.map((linha) => {
      const registro = Number(linha[0]);
      const placa = compacto(linha[26]);
      const clientes = (clientesPorDocumento.get(documento(linha[15])) ?? []).filter(
        (cliente) => compacto(cliente.nomerazaosocial) === compacto(linha[1]),
      );
      if (clientes.length !== 1) throw new Error(`Cliente ambiguo no registro legado ${registro}.`);
      const veiculos = veiculosPorPlaca.get(placa) ?? [];
      if (veiculos.length > 1) throw new Error(`Placa duplicada no Garage Premium: ${placa}.`);
      const veiculo = veiculos[0] ?? null;
      if (veiculo && veiculo.clienteid !== clientes[0].id) {
        throw new Error(`Titular atual divergente no registro legado ${registro}.`);
      }
      const data = dataIso(linha[4]);
      if (!data) throw new Error(`Data invalida no registro legado ${registro}.`);
      return {
        clienteid: clientes[0].id,
        veiculoid: veiculo?.id ?? null,
        descricao: texto(linha[28]) || `Ordem de servico historica #${registro}`,
        dataentrada: meiaNoiteBrasil(data),
        observacoes: observacoes(linha, veiculo),
        createdat: meiaNoiteBrasil(data),
        updatedat: meiaNoiteBrasil(data),
        migracao_referencia: `${PREFIXO}${registro}`,
        veiculo_snapshot: veiculo ? snapshotCadastro(veiculo, linha) : snapshotFonte(linha),
      };
    });
    const vinculadas = linhasInsercao.filter((linha) => linha.veiculoid != null).length;
    if (vinculadas !== QUANTIDADE_VINCULADA) {
      throw new Error(`Foram encontradas ${vinculadas} OS vinculadas; esperado: ${QUANTIDADE_VINCULADA}.`);
    }

    const referencias = linhasInsercao.map((linha) => linha.migracao_referencia);
    const existentes = await client.query(
      "select migracao_referencia from public.ordemservico where migracao_referencia = any($1::text[])",
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
      "select id from public.usuario where lower(email) = lower($1) and ativo = true",
      [CRIADOR_EMAIL],
    );
    if (criadorRes.rowCount !== 1) throw new Error(`Usuario tecnico nao encontrado: ${CRIADOR_EMAIL}`);
    const setorRes = await client.query("select id from public.setor where id = $1", [SETOR_ID]);
    if (setorRes.rowCount !== 1) throw new Error(`Setor da migracao nao encontrado: ${SETOR_ID}`);

    console.log(`Candidatas validadas: ${QUANTIDADE_TOTAL} OS.`);
    console.log(`Vinculadas pela placa: ${vinculadas}; somente historico: ${QUANTIDADE_TOTAL - vinculadas}.`);
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
    if (depois.rows[0].clientes !== antes.rows[0].clientes || depois.rows[0].veiculos !== antes.rows[0].veiculos) {
      throw new Error("A carga alterou a quantidade de clientes ou veiculos.");
    }

    await client.query("COMMIT");
    console.log(`Carga confirmada: ${ids.length} OS, IDs ${ids[0]} a ${ids.at(-1)}.`);
    console.log("Cadastros preservados. Efeitos financeiros, notificacoes e itens: 0.");
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
