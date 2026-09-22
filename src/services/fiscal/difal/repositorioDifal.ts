import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { RegraDifal, TipoRegraDifal } from "@/lib/nfe/difalRegras";

/**
 * Leitura das regras de DIFAL. A tabela tem RLS sem policy para authenticated:
 * o acesso é sempre por aqui, no servidor, com a permissão já conferida pela
 * rota que chamou.
 */

type RegraRow = {
  id: number;
  uf: string;
  tipo_regra: string;
  descricao: string;
  ncm: string | null;
  ncm_prefixo: string | null;
  cest: string | null;
  aliquota_icms_interna: number | string | null;
  aliquota_fcp: number | string | null;
  reducao_base: number | string | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  prioridade: number;
  fonte: string;
  fonte_url: string | null;
  fundamento_legal: string | null;
  data_fonte: string | null;
  ativo: boolean;
};

const COLUNAS =
  "id, uf, tipo_regra, descricao, ncm, ncm_prefixo, cest, aliquota_icms_interna, aliquota_fcp, reducao_base, vigencia_inicio, vigencia_fim, prioridade, fonte, fonte_url, fundamento_legal, data_fonte, ativo";

/**
 * numeric do Postgres chega como string no supabase-js. Converter com Number()
 * direto transformaria NULL em 0 — exatamente a confusão que este motor existe
 * para evitar. Só um valor presente vira número.
 */
function decimalOuNulo(valor: number | string | null): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function paraRegra(row: RegraRow): RegraDifal {
  return {
    id: row.id,
    uf: row.uf,
    tipoRegra: row.tipo_regra as TipoRegraDifal,
    descricao: row.descricao,
    ncm: row.ncm,
    ncmPrefixo: row.ncm_prefixo,
    cest: row.cest,
    aliquotaIcmsInterna: decimalOuNulo(row.aliquota_icms_interna),
    aliquotaFcp: decimalOuNulo(row.aliquota_fcp),
    reducaoBase: decimalOuNulo(row.reducao_base),
    vigenciaInicio: String(row.vigencia_inicio).slice(0, 10),
    vigenciaFim: row.vigencia_fim ? String(row.vigencia_fim).slice(0, 10) : null,
    prioridade: Number(row.prioridade),
    fonte: row.fonte,
    fonteUrl: row.fonte_url,
    fundamentoLegal: row.fundamento_legal,
    dataFonte: row.data_fonte ? String(row.data_fonte).slice(0, 10) : null,
    ativo: Boolean(row.ativo),
  };
}

/**
 * Cache curto por UF. Uma emissão com 30 itens da mesma UF não precisa de 30
 * idas ao banco, e 60 segundos é curto o bastante para uma regra recém-cadastrada
 * aparecer sem ninguém reiniciar nada.
 */
const CACHE_MS = 60_000;
const cache = new Map<string, { em: number; regras: RegraDifal[] }>();

export function limparCacheRegrasDifal() {
  cache.clear();
}

/**
 * Traz todas as regras da UF, inclusive as inativas e as de vigência encerrada:
 * o casamento é feito em memória e a tela de auditoria precisa poder mostrar o
 * histórico. Quem descarta inativa e fora de vigência é casarRegrasDifal.
 */
export async function carregarRegrasDifalPorUf(uf: string): Promise<RegraDifal[]> {
  const chave = String(uf ?? "").trim().toUpperCase();
  if (!chave) return [];

  const emCache = cache.get(chave);
  if (emCache && Date.now() - emCache.em < CACHE_MS) return emCache.regras;

  const { data, error } = await supabaseAdmin
    .from("fiscal_difal_regra")
    .select(COLUNAS)
    .eq("uf", chave)
    .order("vigencia_inicio", { ascending: false });

  if (error) throw error;

  const regras = (data ?? []).map((row) => paraRegra(row as RegraRow));
  cache.set(chave, { em: Date.now(), regras });
  return regras;
}
