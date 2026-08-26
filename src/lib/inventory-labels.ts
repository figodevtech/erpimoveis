import { ROTULOS_ESCOPO, type UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";

/**
 * De qual TABELA o item veio. Produto de venda e item de estoque simples moram em
 * tabelas diferentes; os dois estoques simples dividem `usoconsumo_item` e se
 * distinguem por `escopo`.
 */
export type InventoryLabelKind = "PRODUTO" | "USOCONSUMO";
export type InventoryLabelMatchBy = "ETIQUETA" | "CODIGOBARRAS" | "AMBOS";

/**
 * De qual ESTOQUE o item é, na leitura de quem usa a tela: os tres que existem.
 * É o que a UI rotula e o que a checagem de etiqueta repetida compara.
 */
export type InventoryTarget = "PRODUTO" | UsoConsumoEscopo;

export type InventoryLabelItem = {
  id: number;
  titulo: string | null;
  descricao?: string | null;
  referencia?: string | null;
  fabricante?: string | null;
  codigobarras?: string | null;
  etiqueta?: string | null;
  local?: string | null;
  unidade?: string | null;
  estoque?: number | null;
  estoqueminimo?: number | null;
  status_estoque?: string | null;
  precocompra?: number | null;
  ultimovalordecompra?: number | null;
  ultimovalordevenda?: number | null;
  imgUrl?: string | null;
  img_url?: string | null;
  updatedat?: string | null;
  updated_at?: string | null;
  /** Só vem preenchido quando `kind` é USOCONSUMO. */
  escopo?: UsoConsumoEscopo | null;
};

export type InventoryLabelMatch = {
  kind: InventoryLabelKind;
  /**
   * Escopo do item quando `kind` é USOCONSUMO. Vem separado do item porque a
   * consulta devolve `item: null` para quem não tem permissão de ver o cadastro,
   * e o rótulo do estoque continua sendo informação útil nesse caso.
   */
  escopo?: UsoConsumoEscopo | null;
  matchBy: InventoryLabelMatchBy;
  restricted: boolean;
  item: InventoryLabelItem | null;
};

export type InventoryLabelLookup = {
  code: string;
  status: "AVAILABLE" | "FOUND" | "CONFLICT";
  matches: InventoryLabelMatch[];
};

export async function lookupInventoryLabel(code: string): Promise<InventoryLabelLookup> {
  const response = await fetch(`/api/etiquetas/consultar?codigo=${encodeURIComponent(code.trim())}`, {
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível consultar a etiqueta.");
  return payload.data as InventoryLabelLookup;
}

/** A qual dos tres estoques a linha encontrada pertence. */
export function inventoryTargetOf(match: InventoryLabelMatch): InventoryTarget {
  if (match.kind === "PRODUTO") return "PRODUTO";
  return match.escopo === "GERAL" ? "GERAL" : "USOCONSUMO";
}

const NOME_DO_ESTOQUE: Record<InventoryTarget, string> = {
  PRODUTO: "Produto",
  USOCONSUMO: ROTULOS_ESCOPO.USOCONSUMO.curto,
  GERAL: ROTULOS_ESCOPO.GERAL.nome,
};

export function inventoryTargetLabel(target: InventoryTarget) {
  return NOME_DO_ESTOQUE[target];
}

const ETIQUETA_JA_USADA: Record<InventoryTarget, string> = {
  PRODUTO: "Já existe um produto com esta etiqueta.",
  USOCONSUMO: "Já existe um item de uso e consumo com esta etiqueta.",
  GERAL: "Já existe um item do estoque Geral/Avulso com esta etiqueta.",
};

/**
 * A etiqueta é única entre os TRES estoques — o índice e o trigger global do
 * banco garantem isso. Aqui o objetivo é antecipar a recusa com a mensagem que
 * diz onde a etiqueta já está, em vez de deixar estourar o erro do banco.
 *
 * Código de barras fica de fora de propósito: ele pode repetir entre estoques
 * (é o código do fabricante), só a etiqueta é que não.
 */
export function crossInventoryLabelMessage(target: InventoryTarget, lookup: InventoryLabelLookup) {
  const conflito = lookup.matches.find(
    (match) => match.matchBy !== "CODIGOBARRAS" && inventoryTargetOf(match) !== target,
  );
  return conflito ? ETIQUETA_JA_USADA[inventoryTargetOf(conflito)] : null;
}
