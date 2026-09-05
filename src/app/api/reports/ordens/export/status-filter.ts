import { STATUS_OS_VALIDOS } from "@/lib/ordens/destaque";

const statusValidos = new Set<string>(STATUS_OS_VALIDOS);

export function statusSelecionados(valor: string | null): string[] {
  return [...new Set((valor ?? "").split(",").map(item => item.trim().toUpperCase())
    .filter(item => statusValidos.has(item)))];
}
