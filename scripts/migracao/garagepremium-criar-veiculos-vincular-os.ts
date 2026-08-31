/**
 * Cria veiculos a partir do relatorio aprovado e vincula as OS historicas que
 * estavam somente com snapshot. Equivalencias ambiguas de placa sao excluidas.
 *
 * Uso:
 *   npm run migracao:garage:criar-veiculos-vincular-os
 *   npm run migracao:garage:criar-veiculos-vincular-os -- --aplicar
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const APLICAR = new Set(process.argv.slice(2)).has("--aplicar");
const ARQUIVO = path.join(
  projectRoot,
  "docs",
  "migracao_garagepremium",
  "VEICULOS_CANDIDATOS_PARA_VINCULAR_OS.xlsx",
);
const HASH_ESPERADO = "03912931BA455F47B24F49151DB161AF9BECFAD9706DCECC8485A011AF12B233";
const PREFIXO = "LEGADO_OS_EXPORTACAO:";
const QUANTIDADE_CANDIDATOS = 734;
const QUANTIDADE_VEICULOS_NOVOS = 727;
const QUANTIDADE_VEICULOS_EXISTENTES = 3;
const QUANTIDADE_OS = 1_683;
const CANONICAS_AMBIGUAS = new Map<string, Set<string>>([
  ["FMB0I44", new Set(["FMB0844", "FMB0I44"])],
  ["OFG1J47", new Set(["OFG1947", "OFG1J47"])],
]);
const EXISTENTES_ESPERADOS = new Map<string, { id: number; clienteid: number }>([
  ["NQH4I11", { id: 29, clienteid: 1085 }],
  ["QFM2D16", { id: 71, clienteid: 873 }],
  ["QSD0D12", { id: 34, clienteid: 401 }],
]);

type LinhaPlanilha = Record<string, unknown>;
type Candidato = {
  placa: string;
  canonica: string;
  clienteid: number;
  clienteNome: string;
  clienteDocumento: string;
  marca: string;
  modelo: string;
  ano: number | null;
  anoModelo: number | null;
  chassi: string | null;
  cor: string | null;
  combustivel: string | null;
  km: number | null;
  osIds: number[];
};
type VeiculoBanco = {
  id: number;
  clienteid: number | null;
  placa: string;
  placa_formatada: string;
  marca: string;
  modelo: string;
  ano: number | null;
  ano_modelo: number | null;
  chassi: string | null;
  cor: string | null;
  combustivel: string | null;
  kmatual: number | null;
  tipo: string;
};
type OrdemAntes = {
  id: number;
  clienteid: number;
  veiculoid: number | null;
  migracao_referencia: string;
  status: string;
  dataentrada: Date | string;
  datasaida: Date | string;
  pagamento_concluido_em: Date | string;
  finalizado_em: Date | string;
  orcamentototal: number | string | null;
  subtotal: number | string | null;
  valor_frete: number | string | null;
  placa_snapshot: string;
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

function numeroInteiro(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isInteger(numero) ? numero : null;
}

function listaIds(valor: unknown) {
  return texto(valor)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function conjuntosIguais<T>(a: Set<T>, b: Set<T>) {
  return a.size === b.size && [...a].every((item) => b.has(item));
}

function lerCandidatos() {
  const conteudo = fs.readFileSync(ARQUIVO);
  const hash = crypto.createHash("sha256").update(conteudo).digest("hex").toUpperCase();
  if (hash !== HASH_ESPERADO) throw new Error(`A planilha de candidatos mudou. SHA-256 atual: ${hash}`);
  const workbook = XLSX.read(conteudo);
  const aba = workbook.Sheets.APTOS_CADASTRO_VINCULO;
  if (!aba) throw new Error("A aba APTOS_CADASTRO_VINCULO nao foi encontrada.");
  const linhas = XLSX.utils.sheet_to_json<LinhaPlanilha>(aba, { defval: "", raw: true });
  if (linhas.length !== QUANTIDADE_CANDIDATOS) {
    throw new Error(`A planilha possui ${linhas.length} candidatos; esperado: ${QUANTIDADE_CANDIDATOS}.`);
  }
  return linhas;
}

async function carregarCandidatos(
  client: Awaited<ReturnType<typeof connectDatabase>>["client"],
  linhas: LinhaPlanilha[],
) {
  const placas = linhas.map((linha) => compacto(linha.Placa));
  if (new Set(placas).size !== QUANTIDADE_CANDIDATOS) throw new Error("Ha placas exatas duplicadas na planilha.");
  const canonicasRes = await client.query<{ placa: string; canonica: string }>(
    `select placa, public.to_mercosul_equivalente(placa) canonica
       from unnest($1::text[]) placa`,
    [placas],
  );
  const canonicaPorPlaca = new Map(canonicasRes.rows.map((linha) => [linha.placa, linha.canonica]));

  const candidatos: Candidato[] = linhas.map((linha) => {
    const placa = compacto(linha.Placa);
    const canonica = canonicaPorPlaca.get(placa);
    const clienteid = Number(linha["Cliente proposto ID"]);
    const marca = texto(linha["Marca proposta"]);
    const modelo = texto(linha["Modelo proposto"]);
    const osIds = listaIds(linha["IDs das OS migradas"]);
    if (
      !canonica ||
      !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa) ||
      !Number.isInteger(clienteid) || clienteid <= 0 ||
      !marca || !modelo ||
      texto(linha["Tipo proposto"]) !== "CARROS (INFERIDO)" ||
      texto(linha["Dados mínimos completos"]) !== "SIM" ||
      osIds.length !== Number(linha["OS migradas para vincular"])
    ) {
      throw new Error(`Candidato invalido para a placa ${placa}.`);
    }
    return {
      placa,
      canonica,
      clienteid,
      clienteNome: texto(linha["Cliente proposto"]),
      clienteDocumento: documento(linha["CPF/CNPJ cliente"]),
      marca,
      modelo,
      ano: numeroInteiro(linha["Ano proposto"]),
      anoModelo: numeroInteiro(linha["Ano-modelo proposto"]),
      chassi: compacto(linha["Chassi proposto"]) || null,
      cor: texto(linha["Cor proposta"]) || null,
      combustivel: texto(linha["Combustível proposto"]) || null,
      km: numeroInteiro(linha["KM mais recente"]),
      osIds,
    };
  });

  const porCanonica = new Map<string, Candidato[]>();
  for (const candidato of candidatos) {
    const grupo = porCanonica.get(candidato.canonica) ?? [];
    grupo.push(candidato);
    porCanonica.set(candidato.canonica, grupo);
  }
  if (porCanonica.size !== 732) throw new Error(`Foram encontradas ${porCanonica.size} placas canonicas; esperado: 732.`);
  const ambiguas = [...porCanonica.entries()].filter(([, grupo]) => grupo.length > 1);
  if (ambiguas.length !== CANONICAS_AMBIGUAS.size) throw new Error("Quantidade inesperada de equivalencias ambiguas.");
  for (const [canonica, grupo] of ambiguas) {
    const esperadas = CANONICAS_AMBIGUAS.get(canonica);
    if (!esperadas || !conjuntosIguais(new Set(grupo.map((item) => item.placa)), esperadas)) {
      throw new Error(`Equivalencia inesperada para ${canonica}.`);
    }
  }
  const seguros = candidatos.filter((candidato) => !CANONICAS_AMBIGUAS.has(candidato.canonica));
  if (seguros.length !== 730) throw new Error(`Foram selecionados ${seguros.length} candidatos seguros; esperado: 730.`);
  const osIds = seguros.flatMap((candidato) => candidato.osIds);
  if (osIds.length !== QUANTIDADE_OS || new Set(osIds).size !== QUANTIDADE_OS) {
    throw new Error(`A selecao possui ${osIds.length} OS, com ${new Set(osIds).size} IDs unicos.`);
  }
  return { seguros, osIds };
}

async function auditarCarga(
  client: Awaited<ReturnType<typeof connectDatabase>>["client"],
  osParaVeiculo: Map<number, number>,
  ordensAntes: Map<number, OrdemAntes>,
) {
  const osIds = [...osParaVeiculo.keys()];
  const ordens = await client.query<OrdemAntes & {
    placa_veiculo: string;
    placa_formatada: string;
    placa_snapshot_atual: string;
    marca_snapshot: string;
    modelo_snapshot: string;
    chassi_snapshot: string | null;
    ano_snapshot: string | null;
    ano_modelo_snapshot: string | null;
    marca_veiculo: string;
    modelo_veiculo: string;
    chassi_veiculo: string | null;
    ano_veiculo: number | null;
    ano_modelo_veiculo: number | null;
  }>(
    `select os.id, os.clienteid, os.veiculoid, os.migracao_referencia,
            os.status::text, os.dataentrada, os.datasaida, os.pagamento_concluido_em,
            os.finalizado_em, os.orcamentototal, os.subtotal, os.valor_frete,
            os.veiculo_snapshot ->> 'placa' placa_snapshot,
            v.placa placa_veiculo, v.placa_formatada,
            os.veiculo_snapshot ->> 'placa' placa_snapshot_atual,
            os.veiculo_snapshot ->> 'marca' marca_snapshot,
            os.veiculo_snapshot ->> 'modelo' modelo_snapshot,
            os.veiculo_snapshot ->> 'chassi' chassi_snapshot,
            os.veiculo_snapshot ->> 'ano_fabricacao' ano_snapshot,
            os.veiculo_snapshot ->> 'ano_modelo' ano_modelo_snapshot,
            v.marca marca_veiculo, v.modelo modelo_veiculo, v.chassi chassi_veiculo,
            v.ano ano_veiculo, v.ano_modelo ano_modelo_veiculo
       from public.ordemservico os
       join public.veiculo v on v.id = os.veiculoid
      where os.id = any($1::int[])`,
    [osIds],
  );
  if (ordens.rowCount !== QUANTIDADE_OS) throw new Error(`Auditoria encontrou ${ordens.rowCount} OS.`);
  for (const ordem of ordens.rows) {
    const antes = ordensAntes.get(ordem.id);
    const veiculoEsperado = osParaVeiculo.get(ordem.id);
    if (!antes || !veiculoEsperado) throw new Error(`OS inesperada na auditoria: ${ordem.id}.`);
    const dataEntrada = new Date(antes.dataentrada).getTime();
    if (
      ordem.veiculoid !== veiculoEsperado ||
      ordem.clienteid !== antes.clienteid ||
      ordem.migracao_referencia !== antes.migracao_referencia ||
      ordem.status !== "CONCLUIDO" ||
      new Date(ordem.dataentrada).getTime() !== dataEntrada ||
      new Date(ordem.datasaida).getTime() !== new Date(antes.datasaida).getTime() ||
      new Date(ordem.pagamento_concluido_em).getTime() !== new Date(antes.pagamento_concluido_em).getTime() ||
      new Date(ordem.finalizado_em).getTime() !== new Date(antes.finalizado_em).getTime() ||
      Number(ordem.orcamentototal ?? 0) !== 0 ||
      Number(ordem.subtotal ?? 0) !== 0 ||
      Number(ordem.valor_frete ?? 0) !== 0 ||
      ordem.placa_snapshot_atual !== ordem.placa_veiculo ||
      ordem.marca_snapshot !== ordem.marca_veiculo ||
      ordem.modelo_snapshot !== ordem.modelo_veiculo ||
      (ordem.chassi_snapshot || null) !== (compacto(ordem.chassi_veiculo) || null) ||
      (ordem.ano_snapshot == null ? null : Number(ordem.ano_snapshot)) !== ordem.ano_veiculo ||
      (ordem.ano_modelo_snapshot == null ? null : Number(ordem.ano_modelo_snapshot)) !== ordem.ano_modelo_veiculo
    ) {
      throw new Error(`OS inconsistente apos o vinculo: ${ordem.id}.`);
    }
  }
  const efeitos = await client.query<{ saidas: number; efeitos: number }>(
    `select
       (select count(*)::int from public.os_saida s where s.ordemservico_id=any($1::int[])) saidas,
       (select count(*)::int from public.transacao t where t.ordemservicoid=any($1::int[]))
         + (select count(*)::int from public.pagamento p where p.ordemservicoid=any($1::int[]))
         + (select count(*)::int from public.eventos_financeiros e where e.ordemservicoid=any($1::int[]))
         + (select count(*)::int from public.os_notificacao_evento n where n.ordemservico_id=any($1::int[]))
         + (select count(*)::int from public.osproduto p where p.ordemservicoid=any($1::int[]))
         + (select count(*)::int from public.osservico s where s.ordemservicoid=any($1::int[])) efeitos`,
    [osIds],
  );
  if (efeitos.rows[0].saidas !== QUANTIDADE_OS || efeitos.rows[0].efeitos !== 0) {
    throw new Error(`Efeitos indevidos: ${JSON.stringify(efeitos.rows[0])}.`);
  }
}

async function main() {
  const linhas = lerCandidatos();
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");
  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - criar veiculos e vincular OS`);
  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '180s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${PREFIXO}CRIAR_VEICULOS`]);
    const { seguros, osIds } = await carregarCandidatos(client, linhas);
    const ordensRes = await client.query<OrdemAntes>(
      `select id, clienteid, veiculoid, migracao_referencia, status::text,
              dataentrada, datasaida, pagamento_concluido_em, finalizado_em,
              orcamentototal, subtotal, valor_frete,
              veiculo_snapshot ->> 'placa' placa_snapshot
         from public.ordemservico
        where id = any($1::int[])`,
      [osIds],
    );
    if (ordensRes.rowCount !== QUANTIDADE_OS) throw new Error(`Foram encontradas ${ordensRes.rowCount} OS; esperado: ${QUANTIDADE_OS}.`);
    const ordensAntes = new Map(ordensRes.rows.map((ordem) => [ordem.id, ordem]));
    const jaVinculadas = ordensRes.rows.filter((ordem) => ordem.veiculoid != null);
    if (jaVinculadas.length === QUANTIDADE_OS) {
      const osParaVeiculo = new Map(ordensRes.rows.map((ordem) => [ordem.id, ordem.veiculoid!]));
      await auditarCarga(client, osParaVeiculo, ordensAntes);
      console.log(`Carga ja aplicada e auditada: ${QUANTIDADE_OS} OS vinculadas.`);
      await client.query("ROLLBACK");
      return;
    }
    if (jaVinculadas.length) throw new Error(`Carga parcial encontrada: ${jaVinculadas.length} de ${QUANTIDADE_OS} OS ja vinculadas.`);

    const clienteIds = [...new Set(seguros.map((item) => item.clienteid))];
    const clientesRes = await client.query<{ id: number; cpfcnpj: string; nomerazaosocial: string }>(
      "select id, cpfcnpj, nomerazaosocial from public.cliente where id=any($1::int[]) and coalesce(is_deleted,false)=false",
      [clienteIds],
    );
    const clientes = new Map(clientesRes.rows.map((cliente) => [cliente.id, cliente]));
    if (clientes.size !== clienteIds.length) throw new Error("Nem todos os clientes candidatos continuam ativos.");
    for (const candidato of seguros) {
      const cliente = clientes.get(candidato.clienteid);
      if (
        !cliente ||
        compacto(cliente.nomerazaosocial) !== compacto(candidato.clienteNome) ||
        documento(cliente.cpfcnpj) !== candidato.clienteDocumento
      ) {
        throw new Error(`Cliente divergente para a placa ${candidato.placa}.`);
      }
      for (const osId of candidato.osIds) {
        const ordem = ordensAntes.get(osId);
        if (
          !ordem ||
          ordem.clienteid !== candidato.clienteid ||
          ordem.veiculoid !== null ||
          !ordem.migracao_referencia.startsWith(PREFIXO) ||
          compacto(ordem.placa_snapshot) !== candidato.placa
        ) {
          throw new Error(`OS ${osId} nao confere com o candidato ${candidato.placa}.`);
        }
      }
    }

    const canonicas = [...new Set(seguros.map((item) => item.canonica))];
    const veiculosAtuaisRes = await client.query<VeiculoBanco>(
      `select id, clienteid, placa, placa_formatada, marca, modelo, ano, ano_modelo,
              chassi, cor, combustivel, kmatual, tipo::text
         from public.veiculo
        where placa_formatada=any($1::text[])`,
      [canonicas],
    );
    const atuaisPorCanonica = new Map(veiculosAtuaisRes.rows.map((veiculo) => [veiculo.placa_formatada, veiculo]));
    if (atuaisPorCanonica.size !== QUANTIDADE_VEICULOS_EXISTENTES) {
      throw new Error(`Foram encontrados ${atuaisPorCanonica.size} veiculos equivalentes; esperado: ${QUANTIDADE_VEICULOS_EXISTENTES}.`);
    }
    for (const [canonica, esperado] of EXISTENTES_ESPERADOS) {
      const atual = atuaisPorCanonica.get(canonica);
      if (!atual || atual.id !== esperado.id || atual.clienteid !== esperado.clienteid) {
        throw new Error(`Veiculo equivalente inesperado para ${canonica}.`);
      }
    }
    const novos = seguros.filter((item) => !atuaisPorCanonica.has(item.canonica));
    if (novos.length !== QUANTIDADE_VEICULOS_NOVOS) {
      throw new Error(`Foram selecionados ${novos.length} veiculos novos; esperado: ${QUANTIDADE_VEICULOS_NOVOS}.`);
    }
    const chassisNovos = novos.map((item) => item.chassi).filter((item): item is string => Boolean(item));
    if (new Set(chassisNovos).size !== chassisNovos.length) throw new Error("Ha chassis propostos duplicados entre os veiculos novos.");
    if (chassisNovos.length) {
      const conflitosChassi = await client.query(
        `select id, placa, chassi from public.veiculo
          where regexp_replace(upper(coalesce(chassi,'')), '[^A-Z0-9]', '', 'g')=any($1::text[])`,
        [chassisNovos],
      );
      if (conflitosChassi.rowCount) throw new Error(`Chassis propostos agora conflitam com ${conflitosChassi.rowCount} veiculos.`);
    }

    console.log(`Veiculos novos validados: ${novos.length}.`);
    console.log(`Veiculos equivalentes ja existentes: ${atuaisPorCanonica.size}.`);
    console.log(`OS prontas para vinculo: ${osIds.length}.`);
    console.log("Pares ambiguos excluidos: FMB0844/FMB0I44 e OFG1947/OFG1J47 (27 OS).");
    if (!APLICAR) {
      console.log("Simulacao concluida sem INSERT ou UPDATE; sequencias preservadas.");
      await client.query("ROLLBACK");
      return;
    }

    const antes = await client.query<{ clientes: number; veiculos: number; ordens: number }>(
      `select (select count(*)::int from public.cliente) clientes,
              (select count(*)::int from public.veiculo) veiculos,
              (select count(*)::int from public.ordemservico) ordens`,
    );
    const inseridosRes = await client.query<VeiculoBanco>(
      `insert into public.veiculo (
         clienteid, placa, modelo, marca, ano, cor, kmatual, tipo,
         chassi, ano_modelo, combustivel
       )
       select x.clienteid, x.placa, x.modelo, x.marca, x.ano, x.cor, x.km,
              'CARROS'::public.tipo_veiculo, x.chassi, x.ano_modelo, x.combustivel
         from jsonb_to_recordset($1::jsonb) as x(
           clienteid integer, placa text, modelo text, marca text, ano integer,
           cor text, km integer, chassi text, ano_modelo integer, combustivel text
         )
       returning id, clienteid, placa, placa_formatada, marca, modelo, ano, ano_modelo,
                 chassi, cor, combustivel, kmatual, tipo::text`,
      [JSON.stringify(novos)],
    );
    if (inseridosRes.rowCount !== QUANTIDADE_VEICULOS_NOVOS) {
      throw new Error(`Foram criados ${inseridosRes.rowCount} veiculos; esperado: ${QUANTIDADE_VEICULOS_NOVOS}.`);
    }
    const veiculosPorCanonica = new Map<string, VeiculoBanco>(atuaisPorCanonica);
    for (const veiculo of inseridosRes.rows) {
      if (veiculosPorCanonica.has(veiculo.placa_formatada)) throw new Error(`Veiculo canonico duplicado: ${veiculo.placa_formatada}.`);
      veiculosPorCanonica.set(veiculo.placa_formatada, veiculo);
    }

    const osParaVeiculo = new Map<number, number>();
    for (const candidato of seguros) {
      const veiculo = veiculosPorCanonica.get(candidato.canonica);
      if (!veiculo) throw new Error(`Veiculo nao resolvido para ${candidato.placa}.`);
      for (const osId of candidato.osIds) osParaVeiculo.set(osId, veiculo.id);
    }
    const vinculos = [...osParaVeiculo].map(([osid, veiculoid]) => ({ osid, veiculoid }));
    // Excecao administrativa prevista pela propria trigger de protecao. Vale
    // somente nesta transacao e apenas para o UPDATE explicitamente auditado.
    await client.query("SET LOCAL app.permitir_alterar_os_migrada = 'on'");
    const atualizacao = await client.query(
      `update public.ordemservico os
          set veiculoid = x.veiculoid,
              veiculo_snapshot = coalesce(os.veiculo_snapshot, '{}'::jsonb) || jsonb_build_object(
                'placa', v.placa,
                'marca', v.marca,
                'modelo', v.modelo,
                'ano_fabricacao', v.ano,
                'ano_modelo', v.ano_modelo,
                'chassi', nullif(regexp_replace(upper(coalesce(v.chassi,'')), '[^A-Z0-9]', '', 'g'), ''),
                'cor', v.cor,
                'combustivel', v.combustivel
              )
         from jsonb_to_recordset($1::jsonb) as x(osid integer, veiculoid integer)
         join public.veiculo v on v.id=x.veiculoid
        where os.id=x.osid and os.veiculoid is null`,
      [JSON.stringify(vinculos)],
    );
    if (atualizacao.rowCount !== QUANTIDADE_OS) {
      throw new Error(`Foram vinculadas ${atualizacao.rowCount} OS; esperado: ${QUANTIDADE_OS}.`);
    }

    await auditarCarga(client, osParaVeiculo, ordensAntes);
    const depois = await client.query<{ clientes: number; veiculos: number; ordens: number }>(
      `select (select count(*)::int from public.cliente) clientes,
              (select count(*)::int from public.veiculo) veiculos,
              (select count(*)::int from public.ordemservico) ordens`,
    );
    if (
      depois.rows[0].clientes !== antes.rows[0].clientes ||
      depois.rows[0].veiculos !== antes.rows[0].veiculos + QUANTIDADE_VEICULOS_NOVOS ||
      depois.rows[0].ordens !== antes.rows[0].ordens
    ) {
      throw new Error(`Contagens inesperadas apos a carga: ${JSON.stringify({ antes: antes.rows[0], depois: depois.rows[0] })}.`);
    }

    await client.query("COMMIT");
    const ids = inseridosRes.rows.map((veiculo) => veiculo.id).sort((a, b) => a - b);
    console.log(`Carga confirmada: ${ids.length} veiculos, IDs ${ids[0]} a ${ids.at(-1)}.`);
    console.log(`${QUANTIDADE_OS} OS vinculadas; 25 a veiculos preexistentes e 1.658 aos novos.`);
    console.log("Datas, status, valores, saidas e efeitos financeiros preservados.");
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
