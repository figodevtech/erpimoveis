/**
 * Importa somente OS concluidas com exito e inequivocamente associadas a um
 * cliente existente no Garage Premium.
 *
 * Uso:
 *   npm run migracao:garage:os-historicas
 *   npm run migracao:garage:os-historicas -- --aplicar
 *
 * Sem --aplicar, toda a carga e validada dentro de uma transacao e revertida.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const APLICAR = new Set(process.argv.slice(2)).has("--aplicar");
const ARQUIVO = path.join(projectRoot, "docs", "migracao_garagepremium", "EXPORTAÇÃO OS.xlsx");
const HASH_ESPERADO = "1526E77348871B041ED3B8D1FC6F954C1EDDFCC535188C51AADA7CA1E6E51903";
const PREFIXO = "LEGADO_OS_EXPORTACAO:";
const CRIADOR_EMAIL = "brunolima@figosoftwares.com.br";
const SETOR_ID = 1;
const QUANTIDADE_VINCULADA = 53;
const QUANTIDADE_SNAPSHOT = 1_683;
const QUANTIDADE_TOTAL = QUANTIDADE_VINCULADA + QUANTIDADE_SNAPSHOT;

type Linha = unknown[];

type ClienteBanco = {
  id: number;
  cpfcnpj: string;
  nomerazaosocial: string;
};

type VeiculoBanco = {
  id: number;
  clienteid: number;
  placa: string;
  chassi: string | null;
  ano: number | null;
  ano_modelo: number | null;
};

type Candidato = {
  linha: Linha;
  cliente: ClienteBanco;
  veiculo: VeiculoBanco | null;
  modo: "VINCULADO" | "SNAPSHOT";
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
  if (typeof valor === "number") {
    const partes = XLSX.SSF.parse_date_code(valor);
    if (!partes) return null;
    return `${partes.y}-${String(partes.m).padStart(2, "0")}-${String(partes.d).padStart(2, "0")}`;
  }

  const original = texto(valor);
  const br = original.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = original.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function meiaNoiteBrasil(data: string) {
  return `${data}T00:00:00-03:00`;
}

function mapaUnico<T>(itens: T[], chave: (item: T) => string, rotulo: string) {
  const mapa = new Map<string, T>();
  for (const item of itens) {
    const key = chave(item);
    if (!key) continue;
    if (mapa.has(key)) throw new Error(`${rotulo} duplicado no Garage Premium: ${key}`);
    mapa.set(key, item);
  }
  return mapa;
}

function agruparPorPlaca(linhas: Linha[]) {
  const mapa = new Map<string, Linha[]>();
  for (const linha of linhas) {
    const placa = compacto(linha[26]);
    if (!mapa.has(placa)) mapa.set(placa, []);
    mapa.get(placa)!.push(linha);
  }
  return mapa;
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

function excluirDuplicidades(linhas: Linha[]) {
  const grupos = new Map<string, Linha[]>();
  for (const linha of linhas) {
    const assinatura = assinaturaNatural(linha);
    if (!grupos.has(assinatura)) grupos.set(assinatura, []);
    grupos.get(assinatura)!.push(linha);
  }
  const duplicadas = new Set([...grupos.values()].filter((grupo) => grupo.length > 1).flat());
  return linhas.filter((linha) => !duplicadas.has(linha));
}

function lerFonte() {
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
  const linhas = matriz.slice(1).filter((linha) => linha.some((celula) => celula != null));
  const concluidas = linhas.filter((linha) => compacto(linha[13]) === "CONCLUIDOCOMEXITO");

  if (linhas.length !== 3_570 || concluidas.length !== 2_505) {
    throw new Error(`Contagem inesperada na fonte: ${linhas.length} linhas, ${concluidas.length} concluidas com exito.`);
  }
  return concluidas;
}

function selecionarCandidatos(
  concluidas: Linha[],
  clientes: ClienteBanco[],
  veiculos: VeiculoBanco[],
) {
  const clientePorDocumento = mapaUnico(clientes, (cliente) => documento(cliente.cpfcnpj), "CPF/CNPJ");
  const veiculoPorPlaca = mapaUnico(veiculos, (veiculo) => compacto(veiculo.placa), "Placa");
  const veiculoPorChassi = mapaUnico(
    veiculos.filter((veiculo) => compacto(veiculo.chassi)),
    (veiculo) => compacto(veiculo.chassi),
    "Chassi",
  );

  const chassiFontePorPlaca = new Map<string, Set<string>>();
  const anoFontePorPlaca = new Map<string, Set<number>>();
  const anoModeloFontePorPlaca = new Map<string, Set<number>>();
  for (const linha of concluidas) {
    const placa = compacto(linha[26]);
    if (!placa) continue;
    const chassi = compacto(linha[35]);
    const anoFabricacao = ano(linha[25]);
    const anoModelo = ano(linha[59]);
    if (!chassiFontePorPlaca.has(placa)) chassiFontePorPlaca.set(placa, new Set());
    if (!anoFontePorPlaca.has(placa)) anoFontePorPlaca.set(placa, new Set());
    if (!anoModeloFontePorPlaca.has(placa)) anoModeloFontePorPlaca.set(placa, new Set());
    if (chassi) chassiFontePorPlaca.get(placa)!.add(chassi);
    if (anoFabricacao) anoFontePorPlaca.get(placa)!.add(anoFabricacao);
    if (anoModelo) anoModeloFontePorPlaca.get(placa)!.add(anoModelo);
  }

  const flagsValidas = (linha: Linha) => Number(linha[18]) === 0 && Number(linha[57]) === -1;
  const nomeConfere = (linha: Linha, cliente: ClienteBanco) =>
    compacto(linha[1]) === compacto(cliente.nomerazaosocial);
  const anoConsistente = (fonte: Set<number>, banco: number | null) =>
    fonte.size === 0 || (banco != null && [...fonte].every((valor) => valor === banco));

  const vinculadas: Candidato[] = [];
  for (const linha of concluidas) {
    const cliente = clientePorDocumento.get(documento(linha[15]));
    const veiculo = veiculoPorPlaca.get(compacto(linha[26]));
    if (!cliente || !veiculo || !flagsValidas(linha) || !nomeConfere(linha, cliente)) continue;
    if (veiculo.clienteid !== cliente.id) continue;

    const placa = compacto(linha[26]);
    const chassis = chassiFontePorPlaca.get(placa) ?? new Set<string>();
    const chassiBanco = compacto(veiculo.chassi);
    if (!chassiBanco || chassis.size === 0 || ![...chassis].every((valor) => valor === chassiBanco)) continue;
    if (!anoConsistente(anoFontePorPlaca.get(placa) ?? new Set(), veiculo.ano)) continue;
    if (!anoConsistente(anoModeloFontePorPlaca.get(placa) ?? new Set(), veiculo.ano_modelo)) continue;
    vinculadas.push({ linha, cliente, veiculo, modo: "VINCULADO" });
  }

  const baseSnapshot = concluidas.filter((linha) => {
    const cliente = clientePorDocumento.get(documento(linha[15]));
    return Boolean(
      cliente &&
        !veiculoPorPlaca.has(compacto(linha[26])) &&
        nomeConfere(linha, cliente) &&
        compacto(linha[26]) &&
        flagsValidas(linha),
    );
  });

  const porPlaca = agruparPorPlaca(baseSnapshot);
  const placasComConflito = new Set<string>();
  const placasPorChassi = new Map<string, Set<string>>();

  for (const [placa, linhas] of porPlaca) {
    if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) placasComConflito.add(placa);
    if (valores(linhas, (linha) => compacto(linha[35])).size > 1) placasComConflito.add(placa);
    if (valores(linhas, (linha) => compacto(linha[23])).size > 1) placasComConflito.add(placa);
    if (valores(linhas, (linha) => compacto(linha[24])).size > 1) placasComConflito.add(placa);
    if (valores(linhas, (linha) => ano(linha[25])).size > 1) placasComConflito.add(placa);
    if (valores(linhas, (linha) => ano(linha[59])).size > 1) placasComConflito.add(placa);
    if (valores(linhas, (linha) => documento(linha[15])).size > 1) placasComConflito.add(placa);

    for (const chassi of valores(linhas, (linha) => compacto(linha[35]))) {
      if (!placasPorChassi.has(chassi)) placasPorChassi.set(chassi, new Set());
      placasPorChassi.get(chassi)!.add(placa);
      if (veiculoPorChassi.has(chassi)) placasComConflito.add(placa);
    }
  }

  const chassisReutilizados = new Set(
    [...placasPorChassi.entries()].filter(([, placas]) => placas.size > 1).map(([chassi]) => chassi),
  );
  for (const linha of baseSnapshot) {
    if (chassisReutilizados.has(compacto(linha[35]))) placasComConflito.add(compacto(linha[26]));
  }

  const snapshotsSemDuplicidade = excluirDuplicidades(
    baseSnapshot.filter((linha) => !placasComConflito.has(compacto(linha[26]))),
  );
  const snapshots: Candidato[] = snapshotsSemDuplicidade.map((linha) => ({
    linha,
    cliente: clientePorDocumento.get(documento(linha[15]))!,
    veiculo: null,
    modo: "SNAPSHOT",
  }));

  if (vinculadas.length !== QUANTIDADE_VINCULADA || snapshots.length !== QUANTIDADE_SNAPSHOT) {
    throw new Error(
      `A selecao divergiu da revisao: ${vinculadas.length} vinculadas e ${snapshots.length} snapshots.`,
    );
  }

  const candidatos = [...vinculadas, ...snapshots];
  const referencias = candidatos.map(({ linha }) => `${PREFIXO}${texto(linha[0])}`);
  if (new Set(referencias).size !== QUANTIDADE_TOTAL) {
    throw new Error("A selecao possui referencias legadas duplicadas.");
  }
  return candidatos;
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
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const concluidas = lerFonte();
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");

  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - ${configuracao.label}`);
  console.log(`Projeto Supabase: ${configuracao.projectRef}`);

  const { client } = await connectDatabase(configuracao);
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [PREFIXO]);

    const colunas = await client.query<{ n: number }>(
      `select count(*)::int n
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'ordemservico'
          and column_name in ('migracao_referencia', 'veiculo_snapshot')`,
    );
    if (colunas.rows[0].n !== 2) throw new Error("A migration das OS historicas ainda nao foi aplicada.");

    const clientesRes = await client.query<ClienteBanco>(
      `select id, cpfcnpj, nomerazaosocial from public.cliente where coalesce(is_deleted, false) = false`,
    );
    const veiculosRes = await client.query<VeiculoBanco>(
      `select id, clienteid, placa, chassi, ano, ano_modelo from public.veiculo`,
    );
    const criadorRes = await client.query<{ id: string; nome: string }>(
      `select id, nome from public.usuario where lower(email) = lower($1) and ativo = true`,
      [CRIADOR_EMAIL],
    );
    const setorRes = await client.query<{ id: number; nome: string }>(
      `select id, nome from public.setor where id = $1`,
      [SETOR_ID],
    );
    if (criadorRes.rowCount !== 1) throw new Error(`Usuario tecnico nao encontrado: ${CRIADOR_EMAIL}`);
    if (setorRes.rowCount !== 1) throw new Error(`Setor da migracao nao encontrado: ${SETOR_ID}`);

    const candidatos = selecionarCandidatos(concluidas, clientesRes.rows, veiculosRes.rows);
    const criador = criadorRes.rows[0];
    const linhasInsercao = candidatos.map(({ linha, cliente, veiculo, modo }) => {
      const data = dataIso(linha[4]);
      if (!data) throw new Error(`Data invalida no registro legado ${texto(linha[0])}.`);
      return {
        clienteid: cliente.id,
        veiculoid: veiculo?.id ?? null,
        descricao: texto(linha[28]) || `Ordem de servico historica #${texto(linha[0])}`,
        dataentrada: meiaNoiteBrasil(data),
        observacoes: observacoes(linha),
        createdat: meiaNoiteBrasil(data),
        updatedat: meiaNoiteBrasil(data),
        migracao_referencia: `${PREFIXO}${texto(linha[0])}`,
        veiculo_snapshot: snapshotVeiculo(linha),
        modo,
      };
    });

    const existentes = await client.query<{ referencia: string }>(
      `select migracao_referencia referencia
         from public.ordemservico
        where migracao_referencia like $1
        order by migracao_referencia`,
      [`${PREFIXO}%`],
    );
    if (existentes.rowCount) {
      const esperadas = new Set(linhasInsercao.map((linha) => linha.migracao_referencia));
      const atuais = new Set(existentes.rows.map((linha) => linha.referencia));
      if (atuais.size === esperadas.size && [...atuais].every((referencia) => esperadas.has(referencia))) {
        const auditoriaExistente = await client.query<{
          total: number;
          datas_inconsistentes: number;
          transacoes: number;
          pagamentos: number;
          eventos_financeiros: number;
          saidas: number;
          saidas_inconsistentes: number;
        }>(
          `select
             count(*)::int total,
             count(*) filter (
               where os.datasaida is distinct from os.dataentrada
                  or os.pagamento_concluido_em is distinct from os.dataentrada
                  or os.finalizado_em is distinct from os.dataentrada
             )::int datas_inconsistentes,
             (select count(*)::int from public.transacao t join public.ordemservico o on o.id = t.ordemservicoid where o.migracao_referencia like $1) transacoes,
             (select count(*)::int from public.pagamento p join public.ordemservico o on o.id = p.ordemservicoid where o.migracao_referencia like $1) pagamentos,
             (select count(*)::int from public.eventos_financeiros e join public.ordemservico o on o.id = e.ordemservicoid where o.migracao_referencia like $1) eventos_financeiros,
             (select count(*)::int from public.os_saida s join public.ordemservico o on o.id = s.ordemservico_id where o.migracao_referencia like $1) saidas,
             (select count(*)::int from public.os_saida s join public.ordemservico o on o.id = s.ordemservico_id where o.migracao_referencia like $1 and s.saida_em is distinct from o.dataentrada) saidas_inconsistentes
           from public.ordemservico os
          where os.migracao_referencia like $1`,
          [`${PREFIXO}%`],
        );
        const auditada = auditoriaExistente.rows[0];
        if (
          auditada.total !== QUANTIDADE_TOTAL ||
          auditada.datas_inconsistentes !== 0 ||
          auditada.transacoes !== 0 ||
          auditada.pagamentos !== 0 ||
          auditada.eventos_financeiros !== 0 ||
          auditada.saidas !== QUANTIDADE_TOTAL ||
          auditada.saidas_inconsistentes !== 0
        ) {
          throw new Error(`Auditoria da carga existente falhou: ${JSON.stringify(auditada)}`);
        }
        console.log(`Carga ja aplicada e auditada: ${atuais.size} OS.`);
        console.log("Datas de entrada, saida e conclusao identicas: 100%.");
        console.log("Transacoes, pagamentos e eventos financeiros: 0.");
        await client.query("ROLLBACK");
        return;
      }
      throw new Error(`Carga parcial ou divergente encontrada: ${existentes.rowCount} OS.`);
    }

    // A sequencia do PostgreSQL nao volta no ROLLBACK. Uma simulacao que fizesse
    // INSERT consumiria definitivamente 1.736 numeros mesmo sem gravar as OS.
    if (!APLICAR) {
      console.log(`Candidatas validadas: ${linhasInsercao.length} OS historicas.`);
      console.log("Simulacao concluida sem INSERT; a sequencia de IDs foi preservada.");
      await client.query("ROLLBACK");
      return;
    }

    const antes = await client.query<{ ordens: number; clientes: number; veiculos: number }>(
      `select
         (select count(*)::int from public.ordemservico) ordens,
         (select count(*)::int from public.cliente) clientes,
         (select count(*)::int from public.veiculo) veiculos`,
    );

    const insercao = await client.query<{ id: number; veiculoid: number | null }>(
      `insert into public.ordemservico (
         clienteid, veiculoid, usuariocriadorid, setorid, status, statusaprovacao,
         descricao, dataentrada, datasaida, orcamentototal, valor_frete, subtotal,
         observacoes, createdat, updatedat, prioridade, alvo_tipo, created_by,
         updated_by, is_deleted, pagamento_concluido_em, finalizado_em, forma_pagamento,
         parcelas_pagamento, pagamentos_previstos, migracao_referencia, veiculo_snapshot
       )
       select
         x.clienteid, x.veiculoid, $2::uuid, $3::integer,
         'CONCLUIDO'::public.enum_status_os, 'APROVADA'::public.enum_status_aprovacao,
         x.descricao, x.dataentrada::timestamptz, x.dataentrada::timestamptz, 0, 0, 0,
         x.observacoes, x.createdat::timestamptz, x.updatedat::timestamptz,
         'NORMAL'::public.enum_prioridade_os, 'VEICULO'::public.enum_alvo_reparo,
         $2::uuid, $2::uuid, false, x.dataentrada::timestamptz, x.dataentrada::timestamptz, null, null, null,
         x.migracao_referencia, x.veiculo_snapshot
       from jsonb_to_recordset($1::jsonb) as x(
         clienteid integer,
         veiculoid integer,
         descricao text,
         dataentrada text,
         observacoes text,
         createdat text,
         updatedat text,
         migracao_referencia text,
         veiculo_snapshot jsonb,
         modo text
       )
       returning id, veiculoid`,
      [JSON.stringify(linhasInsercao), criador.id, SETOR_ID],
    );
    if (insercao.rowCount !== QUANTIDADE_TOTAL) {
      throw new Error(`Foram inseridas ${insercao.rowCount} OS; esperado: ${QUANTIDADE_TOTAL}.`);
    }

    const saidasInseridas = await client.query(
      `insert into public.os_saida (
         ordemservico_id, saida_em, retirado_por, documento_observacao,
         registrado_por, created_by, created_at, updated_at
       )
       select
         os.id, os.dataentrada, 'Registro historico migrado',
         'Saida registrada a partir do historico do sistema legado.',
         coalesce(os.usuariocriadorid, os.created_by),
         coalesce(os.created_by, os.usuariocriadorid),
         os.dataentrada, os.dataentrada
       from public.ordemservico os
       where os.migracao_referencia like $1
       on conflict (ordemservico_id) do nothing`,
      [`${PREFIXO}%`],
    );
    if (saidasInseridas.rowCount !== QUANTIDADE_TOTAL) {
      throw new Error(`Foram inseridas ${saidasInseridas.rowCount} saidas; esperado: ${QUANTIDADE_TOTAL}.`);
    }

    const auditoria = await client.query<{
      total: number;
      vinculadas: number;
      snapshots: number;
      financeiro: number;
      notificacoes: number;
      pagamentos: number;
      produtos: number;
      servicos: number;
      datas_inconsistentes: number;
      saidas: number;
      saidas_inconsistentes: number;
      clientes: number;
      veiculos: number;
    }>(
      `select
         count(*)::int total,
         count(*) filter (where os.veiculoid is not null)::int vinculadas,
         count(*) filter (where os.veiculoid is null)::int snapshots,
         (select count(*)::int from public.transacao t join public.ordemservico o on o.id=t.ordemservicoid where o.migracao_referencia like $1) financeiro,
         (select count(*)::int from public.os_notificacao_evento e join public.ordemservico o on o.id=e.ordemservico_id where o.migracao_referencia like $1) notificacoes,
         (select count(*)::int from public.pagamento p join public.ordemservico o on o.id=p.ordemservicoid where o.migracao_referencia like $1) pagamentos,
         (select count(*)::int from public.osproduto p join public.ordemservico o on o.id=p.ordemservicoid where o.migracao_referencia like $1) produtos,
         (select count(*)::int from public.osservico s join public.ordemservico o on o.id=s.ordemservicoid where o.migracao_referencia like $1) servicos,
         count(*) filter (
           where os.datasaida is distinct from os.dataentrada
              or os.pagamento_concluido_em is distinct from os.dataentrada
              or os.finalizado_em is distinct from os.dataentrada
         )::int datas_inconsistentes,
         (select count(*)::int from public.os_saida s join public.ordemservico o on o.id=s.ordemservico_id where o.migracao_referencia like $1) saidas,
         (select count(*)::int from public.os_saida s join public.ordemservico o on o.id=s.ordemservico_id where o.migracao_referencia like $1 and s.saida_em is distinct from o.dataentrada) saidas_inconsistentes,
         (select count(*)::int from public.cliente) clientes,
         (select count(*)::int from public.veiculo) veiculos
       from public.ordemservico os
       where os.migracao_referencia like $1`,
      [`${PREFIXO}%`],
    );
    const validacao = auditoria.rows[0];
    if (
      validacao.total !== QUANTIDADE_TOTAL ||
      validacao.vinculadas !== QUANTIDADE_VINCULADA ||
      validacao.snapshots !== QUANTIDADE_SNAPSHOT ||
      validacao.financeiro !== 0 ||
      validacao.notificacoes !== 0 ||
      validacao.pagamentos !== 0 ||
      validacao.produtos !== 0 ||
      validacao.servicos !== 0 ||
      validacao.datas_inconsistentes !== 0 ||
      validacao.saidas !== QUANTIDADE_TOTAL ||
      validacao.saidas_inconsistentes !== 0 ||
      validacao.clientes !== antes.rows[0].clientes ||
      validacao.veiculos !== antes.rows[0].veiculos
    ) {
      throw new Error(`Auditoria pos-carga falhou: ${JSON.stringify(validacao)}`);
    }

    console.log(`Criador tecnico: ${criador.nome} <${CRIADOR_EMAIL}>`);
    console.log(`Setor: ${setorRes.rows[0].nome} (#${SETOR_ID})`);
    console.log(`OS vinculadas a veiculo existente: ${validacao.vinculadas}`);
    console.log(`OS somente com snapshot do veiculo: ${validacao.snapshots}`);
    console.log(`Efeitos financeiros/notificacoes/itens: 0`);
    console.log(`Clientes e veiculos criados: 0`);

    await client.query("COMMIT");
    console.log(`Carga confirmada: ${QUANTIDADE_TOTAL} OS historicas.`);
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
