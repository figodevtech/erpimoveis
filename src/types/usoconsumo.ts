import type { UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";

export type { UsoConsumoEscopo };

export type UsoConsumoStatus = "OK" | "BAIXO" | "CRITICO" | "SEM_ESTOQUE";
export type UsoConsumoUnidade = "UN" | "JGO" | "KIT" | "PAR" | "CX" | "PCT";
export type UsoConsumoConservacao = "NOVO" | "USADO" | "RECONDICIONADO";

export interface UsoConsumoGrupo {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean;
}

export interface UsoConsumoItem {
  id: number;
  /** Estoque simples ao qual o item pertence. Ver src/lib/usoconsumo/escopo.ts. */
  escopo: UsoConsumoEscopo;
  titulo: string;
  descricao: string | null;
  referencia: string | null;
  fabricante: string | null;
  grupo_id: number | null;
  grupo?: Pick<UsoConsumoGrupo, "id" | "nome"> | null;
  unidade: UsoConsumoUnidade;
  conservacao: UsoConsumoConservacao;
  codigobarras: string | null;
  etiqueta: string | null;
  local: string | null;
  estoque: number;
  estoqueminimo: number;
  status_estoque: UsoConsumoStatus;
  precocompra: number;
  ultimovalordecompra: number | null;
  img_url: string | null;
  ncm: string | null;
  cest: string | null;
  cfop_entrada: string | null;
  origem_mercadoria: string | null;
  csosn: string | null;
  cst: string | null;
  aliquotaicms: number | null;
  cst_pis: string | null;
  aliquota_pis: number | null;
  modo_pis: string | null;
  aliquota_por_unidade_pis: number | null;
  cst_cofins: string | null;
  aliquota_cofins: number | null;
  modo_cofins: string | null;
  aliquota_por_unidade_cofins: number | null;
  cst_ibscbs: string | null;
  cclass_trib: string | null;
  aliquota_ibs_uf: number | null;
  aliquota_ibs_municipio: number | null;
  aliquota_cbs: number | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface UsoConsumoPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UsoConsumoImagem {
  id: number;
  item_id: number;
  url: string;
  path?: string;
  ordem: number;
  created_at: string;
}

