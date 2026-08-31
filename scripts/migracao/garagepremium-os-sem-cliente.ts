/**
 * Migra as OS concluidas cujo cliente nao pode ser vinculado com seguranca.
 * O cliente fica nulo e os dados originais sao preservados em cliente_snapshot.
 * Nenhum cliente ou veiculo e criado/alterado.
 *
 * Uso:
 *   npm run migracao:garage:os-sem-cliente
 *   npm run migracao:garage:os-sem-cliente -- --aplicar
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
const TOTAL_SEM_CLIENTE = 166;
const TOTAL_CARGA = 145;
const TOTAL_VINCULADAS = 35;
const TOTAL_SNAPSHOT = 110;
const TOTAL_RESTANTES = 21;

type Linha = unknown[];
type ClienteBanco = { cpfcnpj: string | null };
type VeiculoBanco = {
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
type LinhaInsercao = {
  clienteid: null;
  veiculoid: number | null;
  descricao: string;
  dataentrada: string;
  observacoes: string;
  createdat: string;
  updatedat: string;
  migracao_referencia: string;
  cliente_snapshot: Record<string, unknown>;
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
  return valorDigitos.length <= 11
    ? valorDigitos.padStart(11, "0")
    : valorDigitos.padStart(14, "0");
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

function distintos<T>(valores: T[]) {
  return [...new Set(valores.filter((valor) => valor !== null && valor !== ""))];
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

function lerFonte() {
  const conteudo = fs.readFileSync(ARQUIVO);
  const hash = crypto.createHash("sha256").update(conteudo).digest("hex").toUpperCase();
  if (hash !== HASH_ESPERADO) throw new Error(`A planilha mudou. SHA-256 atual: ${hash}`);
  const workbook = XLSX.read(conteudo);
  const aba = workbook.SheetNames[0];
  if (!aba) throw new Error("A planilha nao possui abas.");
  return XLSX.utils.sheet_to_json<Linha>(workbook.Sheets[aba], {
    header: 1,
    defval: null,
    raw: true,
  }).slice(1);
}

function snapshotCliente(linha: Linha) {
  return {
    nome: texto(linha[1]),
    cpfcnpj: documento(linha[15]) || null,
    telefone: texto(linha[3]) || null,
    email: texto(linha[22]) || null,
    codigo_legado: texto(linha[37]) || texto(linha[40]) || null,
  };
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
    `Cliente informado no legado: ${texto(linha[1])}. Cadastro operacional nao vinculado.`,
    veiculo
      ? "Veiculo vinculado exclusivamente pela placa; cadastro e proprietario atuais preservados."
      : "Dados do veiculo mantidos somente no snapshot historico; nenhum cadastro foi criado ou alterado.",
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
    clienteid: number | null;
    veiculoid: number | null;
    status: string;
    dataentrada: string;
    datasaida: string;
    pagamento_concluido_em: string;
    finalizado_em: string;
    orcamentototal: string | number | null;
    subtotal: string | number | null;
    valor_frete: string | number | null;
    cliente_nome: string;
    placa: string;
  }>(
    `select id, migracao_referencia, clienteid, veiculoid, status::text,
            dataentrada, datasaida, pagamento_concluido_em, finalizado_em,
            orcamentototal, subtotal, valor_frete,
            cliente_snapshot ->> 'nome' cliente_nome,
            veiculo_snapshot ->> 'placa' placa
       from public.ordemservico
      where migracao_referencia = any($1::text[])`,
    [referencias],
  );
  if (ordens.rowCount !== TOTAL_CARGA) throw new Error(`Auditoria encontrou ${ordens.rowCount} OS.`);
  for (const ordem of ordens.rows) {
    const esperada = esperadas.get(ordem.migracao_referencia);
    if (!esperada) throw new Error(`Referencia inesperada: ${ordem.migracao_referencia}.`);
    const data = new Date(esperada.dataentrada).getTime();
    if (
      ordem.clienteid !== null ||
      ordem.veiculoid !== esperada.veiculoid ||
      ordem.status !== "CONCLUIDO" ||
      ordem.cliente_nome !== esperada.cliente_snapshot.nome ||
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
  if (validacao.saidas !== TOTAL_CARGA || validacao.saidas_inconsistentes !== 0 || validacao.efeitos !== 0) {
    throw new Error(`Efeitos indevidos: ${JSON.stringify(validacao)}.`);
  }
  return ordens.rows.map((ordem) => ordem.id).sort((a, b) => a - b);
}

async function main() {
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");
  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - OS historicas sem cliente`);
  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${PREFIXO}SEM_CLIENTE`]);

    const colunas = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='ordemservico'
          and column_name in ('migracao_referencia', 'veiculo_snapshot', 'cliente_snapshot')`,
    );
    if (colunas.rowCount !== 3) throw new Error("A migration de cliente_snapshot ainda nao foi aplicada.");

    // Uma unica conexao transacional: consultas sequenciais evitam concorrencia
    // no mesmo pg.Client e mantem todo o recorte no mesmo snapshot serializavel.
    const ordensRes = await client.query<{
      migracao_referencia: string;
      clienteid: number | null;
      cliente_snapshot: Record<string, unknown> | null;
    }>(
      `select migracao_referencia, clienteid, cliente_snapshot
         from public.ordemservico
        where migracao_referencia like $1`,
      [`${PREFIXO}%`],
    );
    const clientesRes = await client.query<ClienteBanco>(
      "select cpfcnpj from public.cliente where coalesce(is_deleted, false) = false",
    );
    const veiculosRes = await client.query<VeiculoBanco>(
      `select id, clienteid, placa, marca, modelo, ano, ano_modelo, chassi, cor, combustivel
         from public.veiculo`,
    );

    const migradas = new Set(
      ordensRes.rows.map((ordem) => Number(ordem.migracao_referencia.split(":").at(-1))),
    );
    const migradasSemCliente = new Set(
      ordensRes.rows
        .filter(
          (ordem) =>
            ordem.clienteid == null &&
            ordem.cliente_snapshot &&
            texto(ordem.cliente_snapshot.nome),
        )
        .map((ordem) => Number(ordem.migracao_referencia.split(":").at(-1))),
    );
    const documentosAtivos = new Set(clientesRes.rows.map((cliente) => documento(cliente.cpfcnpj)).filter(Boolean));
    // Reincorpora apenas as linhas desta propria carga para que uma segunda
    // execucao valide o lote ja gravado em vez de acusar contagem divergente.
    const pendentes = lerFonte().filter(
      (linha) =>
        compacto(linha[13]) === "CONCLUIDOCOMEXITO" &&
        (!migradas.has(Number(linha[0])) || migradasSemCliente.has(Number(linha[0]))),
    );
    const semCliente = pendentes.filter((linha) => {
      const doc = documento(linha[15]);
      return !doc || !documentosAtivos.has(doc);
    });
    if (semCliente.length !== TOTAL_SEM_CLIENTE) {
      throw new Error(`Foram encontradas ${semCliente.length} OS sem cliente; esperado: ${TOTAL_SEM_CLIENTE}.`);
    }

    const linhasPorPlaca = new Map<string, Linha[]>();
    const quantidadePorAssinatura = new Map<string, number>();
    for (const linha of pendentes) {
      const placa = compacto(linha[26]);
      if (placa) adicionar(linhasPorPlaca, placa, linha);
      const assinatura = assinaturaNatural(linha);
      quantidadePorAssinatura.set(assinatura, (quantidadePorAssinatura.get(assinatura) ?? 0) + 1);
    }
    const veiculosPorPlaca = new Map<string, VeiculoBanco[]>();
    for (const veiculo of veiculosRes.rows) {
      const placa = compacto(veiculo.placa);
      if (placa) adicionar(veiculosPorPlaca, placa, veiculo);
    }

    const bloqueiosPorRegistro = new Map<number, string[]>();
    const selecionadas = semCliente.filter((linha) => {
      const placa = compacto(linha[26]);
      const grupo = linhasPorPlaca.get(placa) ?? [];
      const bloqueios: string[] = [];
      if (Number(linha[18]) !== 0) bloqueios.push("FLAG_CANCELADO");
      if (Number(linha[57]) !== -1) bloqueios.push("FLAG_NAO_SALVO");
      if (!placa) bloqueios.push("SEM_PLACA");
      else if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) bloqueios.push("PLACA_INVALIDA");
      if ((quantidadePorAssinatura.get(assinaturaNatural(linha)) ?? 0) > 1) bloqueios.push("DUPLICIDADE_NATURAL");
      if (distintos(grupo.map((item) => compacto(item[23]))).length > 1) bloqueios.push("MARCAS_MULTIPLAS_NA_FONTE");
      if (distintos(grupo.map((item) => compacto(item[24]))).length > 1) bloqueios.push("MODELOS_MULTIPLOS_NA_FONTE");
      if (distintos(grupo.map((item) => compacto(item[35]))).length > 1) bloqueios.push("CHASSIS_MULTIPLOS_NA_FONTE");
      if (distintos(grupo.map((item) => ano(item[25]))).length > 1) bloqueios.push("ANOS_MULTIPLOS_NA_FONTE");
      if (distintos(grupo.map((item) => ano(item[59]))).length > 1) bloqueios.push("ANOS_MODELO_MULTIPLOS_NA_FONTE");
      if ((veiculosPorPlaca.get(placa) ?? []).length > 1) bloqueios.push("PLACA_DUPLICADA_NO_BANCO");
      bloqueiosPorRegistro.set(Number(linha[0]), distintos(bloqueios));
      return bloqueios.length === 0;
    });
    const restantes = semCliente.filter((linha) => (bloqueiosPorRegistro.get(Number(linha[0])) ?? []).length > 0);
    if (selecionadas.length !== TOTAL_CARGA || restantes.length !== TOTAL_RESTANTES) {
      throw new Error(`Selecao divergente: ${selecionadas.length} aptas e ${restantes.length} restantes.`);
    }

    const linhasInsercao: LinhaInsercao[] = selecionadas
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map((linha) => {
        const registro = Number(linha[0]);
        const placa = compacto(linha[26]);
        const veiculos = veiculosPorPlaca.get(placa) ?? [];
        const veiculo = veiculos[0] ?? null;
        const data = dataIso(linha[4]);
        if (!data) throw new Error(`Data invalida no registro legado ${registro}.`);
        const cliente = snapshotCliente(linha);
        if (!texto(cliente.nome)) throw new Error(`Cliente legado sem nome no registro ${registro}.`);
        return {
          clienteid: null,
          veiculoid: veiculo?.id ?? null,
          descricao: texto(linha[28]) || `Ordem de servico historica #${registro}`,
          dataentrada: meiaNoiteBrasil(data),
          observacoes: observacoes(linha, veiculo),
          createdat: meiaNoiteBrasil(data),
          updatedat: meiaNoiteBrasil(data),
          migracao_referencia: `${PREFIXO}${registro}`,
          cliente_snapshot: cliente,
          veiculo_snapshot: veiculo ? snapshotCadastro(veiculo, linha) : snapshotFonte(linha),
        };
      });
    const vinculadas = linhasInsercao.filter((linha) => linha.veiculoid != null).length;
    if (vinculadas !== TOTAL_VINCULADAS || TOTAL_CARGA - vinculadas !== TOTAL_SNAPSHOT) {
      throw new Error(`Veiculos divergentes: ${vinculadas} vinculadas e ${TOTAL_CARGA - vinculadas} snapshots.`);
    }

    const referencias = linhasInsercao.map((linha) => linha.migracao_referencia);
    const existentes = await client.query(
      "select migracao_referencia from public.ordemservico where migracao_referencia = any($1::text[])",
      [referencias],
    );
    if (existentes.rowCount === TOTAL_CARGA) {
      const ids = await validarCarga(client, linhasInsercao);
      console.log(`Carga ja aplicada e auditada: ${ids.length} OS.`);
      await client.query("ROLLBACK");
      return;
    }
    if (existentes.rowCount) throw new Error(`Carga parcial encontrada: ${existentes.rowCount} de ${TOTAL_CARGA} OS.`);

    const criadorRes = await client.query<{ id: string }>(
      "select id from public.usuario where lower(email) = lower($1) and ativo = true",
      [CRIADOR_EMAIL],
    );
    if (criadorRes.rowCount !== 1) throw new Error(`Usuario tecnico nao encontrado: ${CRIADOR_EMAIL}`);
    const setorRes = await client.query("select id from public.setor where id = $1", [SETOR_ID]);
    if (setorRes.rowCount !== 1) throw new Error(`Setor da migracao nao encontrado: ${SETOR_ID}`);

    console.log(`Candidatas validadas: ${TOTAL_CARGA} OS; restantes por outros bloqueios: ${TOTAL_RESTANTES}.`);
    console.log(`Veiculo cadastrado: ${vinculadas}; somente snapshots: ${TOTAL_CARGA - vinculadas}.`);
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
         parcelas_pagamento, pagamentos_previstos, migracao_referencia,
         cliente_snapshot, veiculo_snapshot
       )
       select null, x.veiculoid, $2::uuid, $3::integer,
              'CONCLUIDO'::public.enum_status_os, 'APROVADA'::public.enum_status_aprovacao,
              x.descricao, x.dataentrada::timestamptz, x.dataentrada::timestamptz, 0, 0, 0,
              x.observacoes, x.createdat::timestamptz, x.updatedat::timestamptz,
              'NORMAL'::public.enum_prioridade_os, 'VEICULO'::public.enum_alvo_reparo,
              $2::uuid, $2::uuid, false, x.dataentrada::timestamptz, x.dataentrada::timestamptz,
              null, null, null, x.migracao_referencia, x.cliente_snapshot, x.veiculo_snapshot
         from jsonb_to_recordset($1::jsonb) as x(
           veiculoid integer, descricao text, dataentrada text,
           observacoes text, createdat text, updatedat text, migracao_referencia text,
           cliente_snapshot jsonb, veiculo_snapshot jsonb
         )`,
      [JSON.stringify(linhasInsercao), criadorRes.rows[0].id, SETOR_ID],
    );
    if (insercao.rowCount !== TOTAL_CARGA) throw new Error(`Foram inseridas ${insercao.rowCount} OS.`);

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
    if (saidas.rowCount !== TOTAL_CARGA) throw new Error(`Foram inseridas ${saidas.rowCount} saidas.`);

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
    console.log("Clientes e veiculos preservados. Efeitos financeiros, notificacoes e itens: 0.");
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
