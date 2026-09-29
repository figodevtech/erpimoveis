// Listagem de notas fiscais a partir das origens que elas documentam.
//
// Uma NF-e pode cobrir várias OS ou várias vendas (nota consolidada), e nesse
// caso só uma delas fica na coluna escalar de `nfe` — a âncora. As demais
// existem apenas em `nfe_origem_vinculo`. Consultar só a coluna escalar faria
// a nota sumir da lista de todas as origens agregadas, que é exatamente onde o
// usuário vai procurá-la.
//
// Por isso toda leitura aqui é a união de dois caminhos: a coluna escalar (que
// também cobre as notas legadas, anteriores à junção) e a tabela de vínculo.
// É o mesmo desenho que `/api/nfe/por-saida/[id]` já usava para as saídas.

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type TipoOrigemNota = "OS" | "VENDA" | "ENTRADA" | "SAIDA";

/** Uma origem que a nota documenta, para o badge de vínculo. */
export type OrigemDaNota = {
  tipo: TipoOrigemNota;
  id: number;
  /** A origem que abriu a emissão e está na coluna escalar da nota. */
  ancora: boolean;
};

export type NotaComOrigens = Record<string, unknown> & {
  id: number;
  origens: OrigemDaNota[];
};

const COLUNA_ESCALAR: Record<TipoOrigemNota, string> = {
  OS: "ordemservicoid",
  VENDA: "vendaid",
  ENTRADA: "entradaid",
  SAIDA: "saidaid",
};

/**
 * Conjunto único de colunas para as quatro rotas de listagem.
 *
 * Antes cada rota escolhia as suas: `por-venda` trazia `xml_assinado` e
 * `xml_autorizado` (dezenas de KB por linha que a tela não usa), `por-entrada`
 * fazia `select("*")`. O dialog consome todas do mesmo jeito.
 */
const COLUNAS_NOTA = [
  "id",
  "modelo",
  "serie",
  "numero",
  "chave_acesso",
  "ambiente",
  "status",
  "ordemservicoid",
  "vendaid",
  "entradaid",
  "saidaid",
  "clienteid",
  "dataemissao",
  "dataautorizacao",
  "protocolo",
  "total_produtos",
  "total_servicos",
  "total_nfe",
  "justificativacancelamento",
  "codigo_rejeicao",
  "motivo_rejeicao",
  "rejeitada_em",
  "createdat",
  "updatedat",
  "empresaid",
].join(", ");

function paraLista(ids: unknown): number[] {
  const valores = Array.isArray(ids) ? ids : [ids];
  return [
    ...new Set(
      valores
        .map((valor) => Number(valor))
        .filter((valor) => Number.isInteger(valor) && valor > 0),
    ),
  ];
}

/**
 * Lê o parâmetro `ids` de uma query string, aceitando `?ids=1,2,3` e
 * `?ids=1&ids=2`.
 */
export function lerIdsDaQuery(searchParams: URLSearchParams): number[] {
  const bruto = searchParams.getAll("ids").flatMap((valor) => valor.split(","));
  return paraLista(bruto);
}

/** As origens de cada nota, incluindo as que estão fora da seleção consultada. */
async function carregarOrigensDasNotas(nfeIds: number[]) {
  const porNota = new Map<number, OrigemDaNota[]>();
  if (nfeIds.length === 0) return porNota;

  const [{ data: vinculos, error: vinculoError }, { data: saidas, error: saidaError }] =
    await Promise.all([
      supabaseAdmin
        .from("nfe_origem_vinculo")
        .select("nfe_id, tipo, origem_id, ancora")
        .in("nfe_id", nfeIds),
      supabaseAdmin
        .from("nfe_saida_item_vinculo")
        .select("nfe_id, saida_id")
        .in("nfe_id", nfeIds),
    ]);

  if (vinculoError) throw vinculoError;
  if (saidaError) throw saidaError;

  const registrar = (nfeId: number, origem: OrigemDaNota) => {
    const atuais = porNota.get(nfeId) ?? [];
    if (atuais.some((item) => item.tipo === origem.tipo && item.id === origem.id)) return;
    atuais.push(origem);
    porNota.set(nfeId, atuais);
  };

  for (const linha of vinculos ?? []) {
    registrar(Number(linha.nfe_id), {
      tipo: String(linha.tipo) as TipoOrigemNota,
      id: Number(linha.origem_id),
      ancora: Boolean(linha.ancora),
    });
  }

  // A saída tem junção própria, por item; aqui só interessa quais saídas a
  // nota cobre, para o badge.
  for (const linha of saidas ?? []) {
    registrar(Number(linha.nfe_id), {
      tipo: "SAIDA",
      id: Number(linha.saida_id),
      ancora: false,
    });
  }

  return porNota;
}

/**
 * Completa as origens com o que só existe na coluna escalar.
 *
 * Notas legadas não têm linha na junção, e entrada nunca terá. Sem isto, elas
 * apareceriam na lista sem nenhum badge de origem.
 */
function complementarComEscalares(nota: Record<string, any>, origens: OrigemDaNota[]) {
  const completas = [...origens];
  const escalares: Array<[TipoOrigemNota, unknown]> = [
    ["OS", nota.ordemservicoid],
    ["VENDA", nota.vendaid],
    ["ENTRADA", nota.entradaid],
    ["SAIDA", nota.saidaid],
  ];

  for (const [tipo, valor] of escalares) {
    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) continue;
    const existente = completas.find((origem) => origem.tipo === tipo && origem.id === id);
    if (existente) {
      existente.ancora = true;
      continue;
    }
    completas.push({ tipo, id, ancora: true });
  }

  return completas;
}

/**
 * Todas as origens de cada NF-e informada: junção mais coluna escalar.
 *
 * Só serve para `nfe`. A NFS-e tem tabela própria, cujos ids colidem com os
 * da NF-e, e não participa das junções — para ela basta a coluna escalar.
 */
export async function origensDasNotas(notas: Array<Record<string, any> & { id: number }>) {
  const porNota = await carregarOrigensDasNotas(notas.map((nota) => nota.id));
  return new Map(
    notas.map((nota) => [nota.id, complementarComEscalares(nota, porNota.get(nota.id) ?? [])]),
  );
}

/** Origens de uma nota que só conhece as colunas escalares (NFS-e). */
export function origensEscalares(nota: Record<string, any>) {
  return complementarComEscalares(nota, []);
}

/**
 * Notas de uma ou mais origens do mesmo tipo, mais recentes primeiro.
 *
 * O `order` do Postgres não sobrevive à união de duas consultas, então a
 * ordenação final é feita aqui.
 */
export async function listarNotasPorOrigem(
  tipo: TipoOrigemNota,
  ids: number[],
): Promise<NotaComOrigens[]> {
  const origens = paraLista(ids);
  if (origens.length === 0) return [];

  const consultaEscalar = supabaseAdmin
    .from("nfe")
    .select(COLUNAS_NOTA)
    .in(COLUNA_ESCALAR[tipo], origens)
    .eq("is_deleted", false);

  const consultaVinculo =
    tipo === "OS" || tipo === "VENDA"
      ? supabaseAdmin
          .from("nfe_origem_vinculo")
          .select("nfe_id")
          .eq("tipo", tipo)
          .in("origem_id", origens)
      : tipo === "SAIDA"
        ? supabaseAdmin
            .from("nfe_saida_item_vinculo")
            .select("nfe_id")
            .in("saida_id", origens)
        : null;

  const [escalarResult, vinculoResult] = await Promise.all([
    consultaEscalar,
    consultaVinculo ?? Promise.resolve({ data: [] as Array<{ nfe_id: number }>, error: null }),
  ]);

  if (escalarResult.error) throw escalarResult.error;
  if (vinculoResult.error) throw vinculoResult.error;

  const idsVinculadas = [
    ...new Set((vinculoResult.data ?? []).map((linha: any) => Number(linha.nfe_id))),
  ];

  const { data: vinculadas, error: vinculadasError } = idsVinculadas.length
    ? await supabaseAdmin
        .from("nfe")
        .select(COLUNAS_NOTA)
        .in("id", idsVinculadas)
        .eq("is_deleted", false)
    : { data: [] as any[], error: null };

  if (vinculadasError) throw vinculadasError;

  // A âncora volta nas duas consultas; o Map por id resolve a duplicata.
  const porId = new Map<number, Record<string, any>>();
  for (const nota of [...(escalarResult.data ?? []), ...(vinculadas ?? [])] as any[]) {
    porId.set(Number(nota.id), nota);
  }

  const notas = [...porId.values()].sort(
    (a, b) =>
      new Date(b.createdat ?? 0).getTime() - new Date(a.createdat ?? 0).getTime(),
  );

  const origensPorNota = await carregarOrigensDasNotas(notas.map((nota) => Number(nota.id)));

  return notas.map((nota) => ({
    ...nota,
    id: Number(nota.id),
    origens: complementarComEscalares(nota, origensPorNota.get(Number(nota.id)) ?? []),
  })) as NotaComOrigens[];
}
