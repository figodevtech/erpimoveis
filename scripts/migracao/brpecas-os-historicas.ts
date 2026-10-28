/**
 * Importa as OS de 2026 do sistema anterior da BR Pecas como historico
 * concluido: somente leitura, sem veiculo, itens em ositem_historico e nenhum
 * efeito de estoque, financeiro, comissao, notificacao ou Central.
 *
 * Uso:
 *   npm run migracao:brpecas:os-historicas
 *   npm run migracao:brpecas:os-historicas -- --aplicar
 *
 * Sem --aplicar a carga roda inteira com IDs fora da sequencia e termina em
 * ROLLBACK: gatilhos e CHECKs sao exercitados sem gastar numeros de OS.
 * Depende da migration 20261028190000_os_historica_sem_veiculo.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";
import {
  classificarItemBrPecas,
  lerItens,
  lerOrdens,
  montarOrdem,
  type ClassificacaoBrPecas,
  type ItemLegado,
  type OrdemMontada,
} from "./brpecas-os-historicas-lib";
import { arredondarMoeda, normalizarTexto } from "./garagepremium-orcamentos-lib";

const APLICAR = new Set(process.argv.slice(2)).has("--aplicar");
const DIRETORIO = path.join(projectRoot, "docs", "migracao-brpecas");
const ARQUIVO_ORDENS = "ordens_serviço.html";
const ARQUIVO_ITENS = "os_itens.html";
const HASH_ORDENS = "9CC525DA65B1923EFAE46D7D43D094FF7213A9DED9C96BA49D69E64B32E27B6C";
const HASH_ITENS = "8C4C849695EF491581FDDDDEAB1C4B96C0A31FE3FFD4ECB4BCB957C447AB02A1";
const PREFIXO = "LEGADO_BRPECAS_OS:";
const ORIGEM_ITENS = "BRPECAS_OS_ITENS_HTML";
const MIGRATION = "20261028190000";
const CRIADOR_EMAIL = "brunolima@figosoftwares.com.br";
const SETOR_ID = 1;
const QUANTIDADE_OS = 337;
const QUANTIDADE_ITENS = 1_338;
const QUANTIDADE_CONSUMIDOR_FINAL = 85;
const TOTAL_MIGRADO = 414_310.09;
// Itens que o relatorio do legado nao exportou; a OS fica com a soma dos itens.
const DIVERGENCIAS = new Map([
  ["0019223", 1_000],
  ["0019328", 1_500],
]);
const ID_SIMULACAO = 900_000_000;
const LOTE_ITENS = 1_000;

type Client = Awaited<ReturnType<typeof connectDatabase>>["client"];
type ItemClassificado = ItemLegado & ClassificacaoBrPecas;
type Fonte = {
  ordens: OrdemMontada[];
  itensPorOrdem: Map<string, ItemClassificado[]>;
  totalItens: number;
};
type Coincidencia = { nome: string; ordens: string[]; clienteId: number; nomeCadastro: string };

function nomeNormalizado(nome: string) {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// O "ç" do nome pode estar gravado composto ou decomposto, conforme quem copiou.
function lerArquivo(nome: string, hashEsperado: string) {
  const encontrado = fs.readdirSync(DIRETORIO).find((item) => nomeNormalizado(item) === nomeNormalizado(nome));
  if (!encontrado) throw new Error(`Arquivo nao encontrado: ${nome}.`);
  const conteudo = fs.readFileSync(path.join(DIRETORIO, encontrado));
  const hash = crypto.createHash("sha256").update(conteudo).digest("hex").toUpperCase();
  if (hash !== hashEsperado) throw new Error(`${nome} mudou desde a conferencia. SHA-256 atual: ${hash}`);
  return new TextDecoder("windows-1252").decode(conteudo);
}

function lerFonte(): Fonte {
  const legadas = lerOrdens(lerArquivo(ARQUIVO_ORDENS, HASH_ORDENS));
  const itens = lerItens(lerArquivo(ARQUIVO_ITENS, HASH_ITENS));

  const itensPorOrdem = new Map<string, ItemClassificado[]>();
  for (const item of itens) {
    if (!itensPorOrdem.has(item.numero)) itensPorOrdem.set(item.numero, []);
    itensPorOrdem.get(item.numero)!.push({ ...item, ...classificarItemBrPecas(item.descricao) });
  }
  const numeros = new Set(legadas.map((ordem) => ordem.numero));
  if (numeros.size !== legadas.length) throw new Error("Numero de OS repetido no legado.");
  const orfaos = [...itensPorOrdem.keys()].filter((numero) => !numeros.has(numero));
  if (orfaos.length) throw new Error(`Itens de OS ausentes no relatorio de OS: ${orfaos.join(", ")}.`);

  const ordens = legadas
    .map((ordem) => montarOrdem(ordem, itensPorOrdem.get(ordem.numero) ?? []))
    .sort((a, b) => a.dataentrada.localeCompare(b.dataentrada) || a.numero.localeCompare(b.numero));

  const divergentes = ordens.filter((ordem) => ordem.diferencaLegado !== 0);
  if (
    divergentes.length !== DIVERGENCIAS.size ||
    divergentes.some((ordem) => DIVERGENCIAS.get(ordem.numero) !== ordem.diferencaLegado)
  ) {
    throw new Error(
      `Divergencias entre OS e itens mudaram: ${divergentes.map((o) => `${o.numero}=${o.diferencaLegado}`).join(", ")}.`,
    );
  }
  const consumidorFinal = ordens.filter((ordem) => ordem.consumidorFinal).length;
  const total = arredondarMoeda(ordens.reduce((soma, ordem) => soma + ordem.orcamentototal, 0));
  if (
    ordens.length !== QUANTIDADE_OS ||
    itens.length !== QUANTIDADE_ITENS ||
    consumidorFinal !== QUANTIDADE_CONSUMIDOR_FINAL ||
    total !== TOTAL_MIGRADO
  ) {
    throw new Error(
      `Fonte inesperada: ${ordens.length} OS, ${itens.length} itens, ${consumidorFinal} de Consumidor Final, total ${total}.`,
    );
  }
  return { ordens, itensPorOrdem, totalItens: itens.length };
}

/** Contagens do banco inteiro; a carga nao pode mudar nenhuma delas. */
async function contagensGlobais(client: Client) {
  const { rows } = await client.query<Record<string, string>>(
    `select
       (select count(*) from public.cliente)::text clientes,
       (select count(*) from public.veiculo)::text veiculos,
       (select count(*) from public.produto)::text produtos,
       (select count(*) from public.servico)::text servicos,
       (select coalesce(sum(estoque), 0) from public.produto)::text estoque_total,
       (select count(*) from public.estoque_movimento)::text estoque_movimentos,
       (select count(*) from public.transacao)::text transacoes,
       (select count(*) from public.pagamento)::text pagamentos,
       (select count(*) from public.eventos_financeiros)::text eventos_financeiros,
       (select count(*) from public.os_notificacao_evento)::text notificacoes,
       (select count(*) from public.central_evento_operacional)::text eventos_central,
       (select count(*) from public.os_comissao_criacao)::text comissoes_criacao,
       (select count(*) from public.osproduto)::text osprodutos,
       (select count(*) from public.osproduto_avulso)::text osprodutos_avulsos,
       (select count(*) from public.osservico)::text osservicos,
       (select count(*) from public.osservico_realizador)::text realizadores`,
  );
  return rows[0];
}

async function auditarCarga(client: Client, consumidorFinalId: number) {
  const { rows } = await client.query<Record<string, string>>(
    `select
       count(*)::text total,
       count(*) filter (where o.clienteid = $2)::text consumidor_final,
       count(*) filter (where o.clienteid is null and coalesce(o.cliente_snapshot ->> 'nome', '') <> '')::text snapshots,
       count(*) filter (where o.clienteid is not null and o.clienteid <> $2)::text outros_clientes,
       count(*) filter (where o.veiculoid is not null or o.veiculo_snapshot is not null)::text com_veiculo,
       count(*) filter (where o.status::text <> 'CONCLUIDO')::text fora_de_concluido,
       count(*) filter (
         where o.datasaida is distinct from o.dataentrada
            or o.pagamento_concluido_em is distinct from o.dataentrada
            or o.finalizado_em is distinct from o.dataentrada
       )::text datas_inconsistentes,
       count(*) filter (where o.execucao_fim_em is not null)::text com_execucao_fim,
       coalesce(sum(o.orcamentototal), 0)::text total_migrado,
       count(*) filter (
         where o.subtotal <> (select coalesce(sum(h.subtotal), 0) from public.ositem_historico h where h.ordemservicoid = o.id)
       )::text subtotal_divergente,
       (select count(*) from public.ositem_historico h join public.ordemservico x on x.id = h.ordemservicoid
         where x.migracao_referencia like $1)::text itens,
       (select count(*) from public.ositem_historico h join public.ordemservico x on x.id = h.ordemservicoid
         where x.migracao_referencia like $1 and h.origem <> $3)::text itens_outra_origem,
       (select count(*) from public.os_saida s join public.ordemservico x on x.id = s.ordemservico_id
         where x.migracao_referencia like $1)::text saidas,
       (select count(*) from public.os_saida s join public.ordemservico x on x.id = s.ordemservico_id
         where x.migracao_referencia like $1 and s.saida_em is distinct from x.dataentrada)::text saidas_inconsistentes
     from public.ordemservico o
     where o.migracao_referencia like $1`,
    [`${PREFIXO}%`, consumidorFinalId, ORIGEM_ITENS],
  );
  return rows[0];
}

function validarCarga(auditoria: Record<string, string>) {
  const esperado: Record<string, number> = {
    total: QUANTIDADE_OS,
    consumidor_final: QUANTIDADE_CONSUMIDOR_FINAL,
    snapshots: QUANTIDADE_OS - QUANTIDADE_CONSUMIDOR_FINAL,
    outros_clientes: 0,
    com_veiculo: 0,
    fora_de_concluido: 0,
    datas_inconsistentes: 0,
    com_execucao_fim: 0,
    total_migrado: TOTAL_MIGRADO,
    subtotal_divergente: 0,
    itens: QUANTIDADE_ITENS,
    itens_outra_origem: 0,
    saidas: QUANTIDADE_OS,
    saidas_inconsistentes: 0,
  };
  const divergentes = Object.entries(esperado).filter(([campo, valor]) => Number(auditoria[campo]) !== valor);
  if (divergentes.length) {
    throw new Error(
      `Auditoria da carga falhou: ${divergentes.map(([campo, valor]) => `${campo}=${auditoria[campo]} (esperado ${valor})`).join(", ")}.`,
    );
  }
}

async function coincidenciasPorNome(client: Client, fonte: Fonte): Promise<Coincidencia[]> {
  const { rows } = await client.query<{ id: number; nomerazaosocial: string }>(
    `select id, nomerazaosocial from public.cliente
      where coalesce(is_deleted, false) = false and codigo_sistema is null`,
  );
  const cadastroPorNome = new Map(rows.map((cliente) => [normalizarTexto(cliente.nomerazaosocial), cliente]));
  const porNome = new Map<string, Coincidencia>();
  for (const ordem of fonte.ordens) {
    const nome = ordem.clienteSnapshot?.nome;
    const cadastro = nome ? cadastroPorNome.get(normalizarTexto(nome)) : undefined;
    if (!nome || !cadastro) continue;
    const atual = porNome.get(nome) ?? { nome, ordens: [], clienteId: cadastro.id, nomeCadastro: cadastro.nomerazaosocial };
    atual.ordens.push(ordem.numero);
    porNome.set(nome, atual);
  }
  return [...porNome.values()];
}

function gravarRelatorio(fonte: Fonte, ids: Map<string, number> | null, coincidencias: Coincidencia[]) {
  const idDaOs = (numero: string) => ids?.get(numero) ?? "simulação";
  const itens = fonte.ordens.flatMap((ordem) => fonte.itensPorOrdem.get(ordem.numero) ?? []);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      { Indicador: "OS migradas", Valor: fonte.ordens.length },
      { Indicador: "Vinculadas ao Consumidor Final", Valor: fonte.ordens.filter((o) => o.consumidorFinal).length },
      { Indicador: "Somente com o nome do cliente", Valor: fonte.ordens.filter((o) => !o.consumidorFinal).length },
      { Indicador: "Itens", Valor: itens.length },
      { Indicador: "Produtos", Valor: itens.filter((item) => item.tipo === "PRODUTO").length },
      { Indicador: "Serviços", Valor: itens.filter((item) => item.tipo === "SERVICO").length },
      { Indicador: "Total no sistema anterior", Valor: arredondarMoeda(fonte.ordens.reduce((s, o) => s + o.totalLegado, 0)) },
      { Indicador: "Total migrado", Valor: arredondarMoeda(fonte.ordens.reduce((s, o) => s + o.orcamentototal, 0)) },
    ]),
    "Resumo",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      fonte.ordens.map((ordem) => {
        const daOrdem = fonte.itensPorOrdem.get(ordem.numero) ?? [];
        return {
          "OS legada": ordem.numero,
          "ID no ERP": idDaOs(ordem.numero),
          Entrada: ordem.dataentrada,
          Cliente: ordem.clienteSnapshot?.nome ?? "Consumidor Final",
          Vínculo: ordem.consumidorFinal ? "Consumidor Final (cadastro do sistema)" : "Somente o nome (sem documento)",
          "Situação no legado": ordem.situacao,
          "Total no legado": ordem.totalLegado,
          Subtotal: ordem.subtotal,
          Desconto: ordem.desconto,
          "Total migrado": ordem.orcamentototal,
          "Diferença": ordem.diferencaLegado,
          Mecânicos: ordem.mecanicos.join(", "),
          Itens: daOrdem.length,
          Produtos: daOrdem.filter((item) => item.tipo === "PRODUTO").length,
          Serviços: daOrdem.filter((item) => item.tipo === "SERVICO").length,
        };
      }),
    ),
    "OS",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      itens.map((item) => ({
        "OS legada": item.numero,
        "ID no ERP": idDaOs(item.numero),
        "Linha origem": item.linhaOrigem,
        Tipo: item.tipo,
        "Motivo da classificação": item.motivo,
        Descrição: item.descricao,
        Quantidade: item.quantidade,
        "Preço unitário": item.precoUnitario,
        Subtotal: item.subtotal,
        "Mecânico no legado": item.mecanico,
      })),
    ),
    "Itens",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      coincidencias.map((item) => ({
        "Nome no legado": item.nome,
        "OS legadas": item.ordens.join(", "),
        "Cliente no cadastro": item.clienteId,
        "Nome no cadastro": item.nomeCadastro,
        Situação: "Não vinculado: só o CPF/CNPJ vincula; conferir e decidir",
      })),
      { header: ["Nome no legado", "OS legadas", "Cliente no cadastro", "Nome no cadastro", "Situação"] },
    ),
    "Clientes por nome",
  );
  const saida = path.join(DIRETORIO, "AUDITORIA_MIGRACAO_OS.xlsx");
  fs.writeFileSync(saida, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  return saida;
}

async function main() {
  const fonte = lerFonte();
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "brpecas");
  if (!configuracao) throw new Error("Banco BR Pecas nao configurado.");

  console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - ${configuracao.label}`);
  console.log(`Projeto Supabase: ${configuracao.projectRef}`);

  const { client } = await connectDatabase(configuracao);
  let ids: Map<string, number> | null = null;
  let coincidencias: Coincidencia[] = [];
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [PREFIXO]);

    const estrutura = await client.query<{ migration: boolean; codigo_nulavel: boolean }>(
      `select
         exists (select 1 from supabase_migrations.schema_migrations where version = $1) migration,
         exists (
           select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'ositem_historico'
              and column_name = 'codigo_legado' and is_nullable = 'YES'
         ) codigo_nulavel`,
      [MIGRATION],
    );
    if (!estrutura.rows[0].migration || !estrutura.rows[0].codigo_nulavel) {
      throw new Error(`A migration ${MIGRATION}_os_historica_sem_veiculo ainda nao foi aplicada na BR Pecas.`);
    }

    const consumidorRes = await client.query<{ id: number }>(
      `select id from public.cliente where codigo_sistema = 'consumidor_final' and coalesce(is_deleted, false) = false`,
    );
    const criadorRes = await client.query<{ id: string; nome: string }>(
      `select id, nome from public.usuario where lower(email) = lower($1) and ativo = true`,
      [CRIADOR_EMAIL],
    );
    const setorRes = await client.query<{ id: number; nome: string }>(
      `select id, nome from public.setor where id = $1`,
      [SETOR_ID],
    );
    if (consumidorRes.rowCount !== 1) throw new Error("Cadastro do Consumidor Final nao encontrado.");
    if (criadorRes.rowCount !== 1) throw new Error(`Usuario tecnico nao encontrado: ${CRIADOR_EMAIL}`);
    if (setorRes.rowCount !== 1) throw new Error(`Setor da migracao nao encontrado: ${SETOR_ID}`);
    const consumidorFinalId = consumidorRes.rows[0].id;
    const criador = criadorRes.rows[0];
    coincidencias = await coincidenciasPorNome(client, fonte);

    const existentes = await client.query<{ id: number; referencia: string }>(
      `select id, migracao_referencia referencia from public.ordemservico where migracao_referencia like $1`,
      [`${PREFIXO}%`],
    );
    if (existentes.rowCount) {
      const esperadas = new Set(fonte.ordens.map((ordem) => `${PREFIXO}${ordem.numero}`));
      const completa =
        existentes.rowCount === esperadas.size && existentes.rows.every((linha) => esperadas.has(linha.referencia));
      if (!completa) throw new Error(`Carga parcial ou divergente encontrada: ${existentes.rowCount} OS.`);
      validarCarga(await auditarCarga(client, consumidorFinalId));
      await client.query("ROLLBACK");
      console.log(`Carga ja aplicada e auditada: ${existentes.rowCount} OS, ${QUANTIDADE_ITENS} itens.`);
      return;
    }

    if (!APLICAR) {
      const ocupados = await client.query<{ n: number }>(
        `select count(*)::int n from public.ordemservico where id >= $1`,
        [ID_SIMULACAO],
      );
      if (ocupados.rows[0].n) throw new Error(`Faixa de IDs da simulacao ocupada a partir de ${ID_SIMULACAO}.`);
    }

    const antes = await contagensGlobais(client);
    const linhas = fonte.ordens.map((ordem, indice) => ({
      ordem: indice + 1,
      id: APLICAR ? null : ID_SIMULACAO + indice,
      clienteid: ordem.consumidorFinal ? consumidorFinalId : null,
      descricao: ordem.descricao,
      dataentrada: ordem.dataentrada,
      subtotal: ordem.subtotal,
      desconto_tipo: ordem.desconto > 0 ? "FIXO" : null,
      desconto: ordem.desconto,
      orcamentototal: ordem.orcamentototal,
      observacoes: ordem.observacoes,
      migracao_referencia: `${PREFIXO}${ordem.numero}`,
      cliente_snapshot: ordem.clienteSnapshot,
    }));

    // Na simulacao o ID vai explicito: a sequencia nao volta no ROLLBACK.
    const insercao = await client.query<{ id: number; referencia: string }>(
      `insert into public.ordemservico (
         ${APLICAR ? "" : "id, "}clienteid, veiculoid, usuariocriadorid, setorid, status, statusaprovacao,
         descricao, dataentrada, datasaida, subtotal, desconto_tipo, desconto, orcamentototal,
         valor_frete, observacoes, createdat, updatedat, prioridade, alvo_tipo, created_by,
         updated_by, is_deleted, pagamento_concluido_em, finalizado_em, forma_pagamento,
         parcelas_pagamento, pagamentos_previstos, migracao_referencia, cliente_snapshot, veiculo_snapshot
       )
       ${APLICAR ? "" : "overriding system value"}
       select
         ${APLICAR ? "" : "x.id, "}x.clienteid, null, $2::uuid, $3::integer,
         'CONCLUIDO'::public.enum_status_os, 'APROVADA'::public.enum_status_aprovacao,
         x.descricao, x.dataentrada, x.dataentrada, x.subtotal,
         x.desconto_tipo::public.enum_tipo_desconto_venda, x.desconto, x.orcamentototal,
         0, x.observacoes, x.dataentrada, x.dataentrada,
         'NORMAL'::public.enum_prioridade_os, 'VEICULO'::public.enum_alvo_reparo, $2::uuid,
         $2::uuid, false, x.dataentrada, x.dataentrada, null,
         null, null, x.migracao_referencia, x.cliente_snapshot, null
       from jsonb_to_recordset($1::jsonb) as x(
         ordem integer,
         id integer,
         clienteid integer,
         descricao text,
         dataentrada timestamptz,
         subtotal numeric,
         desconto_tipo text,
         desconto numeric,
         orcamentototal numeric,
         observacoes text,
         migracao_referencia text,
         cliente_snapshot jsonb
       )
       order by x.ordem
       returning id, migracao_referencia referencia`,
      [JSON.stringify(linhas), criador.id, SETOR_ID],
    );
    if (insercao.rowCount !== QUANTIDADE_OS) {
      throw new Error(`Foram inseridas ${insercao.rowCount} OS; esperado: ${QUANTIDADE_OS}.`);
    }
    ids = new Map(insercao.rows.map((linha) => [linha.referencia.slice(PREFIXO.length), linha.id]));

    const saidas = await client.query(
      `insert into public.os_saida (
         ordemservico_id, saida_em, retirado_por, documento_observacao,
         registrado_por, created_by, created_at, updated_at
       )
       select
         os.id, os.dataentrada, 'Registro histórico migrado',
         'Saída registrada a partir do histórico do sistema anterior.',
         os.usuariocriadorid, os.usuariocriadorid, os.dataentrada, os.dataentrada
       from public.ordemservico os
       where os.migracao_referencia like $1
       on conflict (ordemservico_id) do nothing`,
      [`${PREFIXO}%`],
    );
    if (saidas.rowCount !== QUANTIDADE_OS) {
      throw new Error(`Foram inseridas ${saidas.rowCount} saidas; esperado: ${QUANTIDADE_OS}.`);
    }

    const itens = fonte.ordens.flatMap((ordem) =>
      (fonte.itensPorOrdem.get(ordem.numero) ?? []).map((item) => ({
        ordemservicoid: ids!.get(ordem.numero),
        linha_origem: item.linhaOrigem,
        tipo: item.tipo,
        descricao: item.descricao,
        quantidade: item.quantidade,
        preco_unitario: item.precoUnitario,
        subtotal: item.subtotal,
      })),
    );
    for (let inicio = 0; inicio < itens.length; inicio += LOTE_ITENS) {
      const lote = itens.slice(inicio, inicio + LOTE_ITENS);
      const resultado = await client.query(
        `insert into public.ositem_historico (
           ordemservicoid, origem, linha_origem, tipo, codigo_legado, descricao,
           unidade, quantidade, preco_unitario, subtotal
         )
         select x.ordemservicoid, $2, x.linha_origem, x.tipo, null, x.descricao,
                null, x.quantidade, x.preco_unitario, x.subtotal
           from jsonb_to_recordset($1::jsonb) as x(
             ordemservicoid integer, linha_origem integer, tipo text, descricao text,
             quantidade numeric, preco_unitario numeric, subtotal numeric
           )`,
        [JSON.stringify(lote), ORIGEM_ITENS],
      );
      if (resultado.rowCount !== lote.length) {
        throw new Error(`Lote de itens gravou ${resultado.rowCount} de ${lote.length}.`);
      }
    }

    const depois = await contagensGlobais(client);
    const efeitos = Object.keys(antes).filter((campo) => antes[campo] !== depois[campo]);
    if (efeitos.length) {
      throw new Error(`A carga mudou o banco fora das OS: ${efeitos.map((c) => `${c} ${antes[c]} -> ${depois[c]}`).join(", ")}.`);
    }
    validarCarga(await auditarCarga(client, consumidorFinalId));

    console.log(`Criador tecnico: ${criador.nome} <${CRIADOR_EMAIL}>`);
    console.log(`Setor: ${setorRes.rows[0].nome} (#${SETOR_ID})`);
    console.log(`OS: ${QUANTIDADE_OS} (${QUANTIDADE_CONSUMIDOR_FINAL} no Consumidor Final, ${QUANTIDADE_OS - QUANTIDADE_CONSUMIDOR_FINAL} so com o nome)`);
    console.log(`Itens historicos: ${fonte.totalItens}; total migrado: R$ ${TOTAL_MIGRADO.toFixed(2)}`);
    console.log("Estoque, financeiro, comissao, notificacao, Central e cadastros: sem alteracao.");

    if (APLICAR) {
      await client.query("COMMIT");
      const faixa = [...ids.values()];
      console.log(`Carga confirmada: OS ${Math.min(...faixa)} a ${Math.max(...faixa)}.`);
    } else {
      ids = null;
      await client.query("ROLLBACK");
      console.log("Simulacao completa revertida; a sequencia de OS foi preservada.");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  console.log(`Relatorio: ${gravarRelatorio(fonte, ids, coincidencias)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
