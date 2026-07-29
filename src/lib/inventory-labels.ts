export type InventoryLabelKind = "PRODUTO" | "USOCONSUMO";
export type InventoryLabelMatchBy = "ETIQUETA" | "CODIGOBARRAS" | "AMBOS";

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
  imgUrl?: string | null;
  img_url?: string | null;
  updatedat?: string | null;
  updated_at?: string | null;
};

export type InventoryLabelMatch = {
  kind: InventoryLabelKind;
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

export function crossInventoryLabelMessage(target: InventoryLabelKind, lookup: InventoryLabelLookup) {
  const other = target === "PRODUTO" ? "USOCONSUMO" : "PRODUTO";
  if (!lookup.matches.some((match) => match.kind === other && match.matchBy !== "CODIGOBARRAS")) return null;
  return target === "PRODUTO"
    ? "Já existe um item de uso e consumo com esta etiqueta."
    : "Já existe um produto com esta etiqueta.";
}
