// ./src/app/(app)/(pages)/ordens/components/dialogs/realizadores/types.ts
import type { UsuarioAtivo } from "../../../lib/api";

export type RealizadorLite = { id: string; nome: string | null };

export type ItemServico = {
  ordemservicoid: number;
  servicoid: number;

  quantidade?: number;
  precounitario?: number;
  subtotal?: number;

  servico?: { descricao?: string | null; codigo?: string | null } | null;

  realizadores?: RealizadorLite[] | null;
};

/** Estado derivado de um serviço da OS dentro do dialog. */
export type ServicoLinha = {
  key: string;
  servicoid: number;
  titulo: string;
  baseTotal: number;
  ids: string[];
  pendenteSalvar: boolean;
  semRealizador: boolean;
  erroSalvar: string | null;
};

export const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);

export const percent = (v: number) =>
  `${(Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export function comissaoDe(u: UsuarioAtivo | undefined | null): number {
  return Number(u?.comissao_percent ?? 0) || 0;
}

export function nomeDe(u: UsuarioAtivo | undefined | null, fallbackId: string): string {
  return u?.nome ?? u?.email ?? fallbackId;
}

export function uniq(arr: string[]) {
  return [...new Set(arr)];
}

export function sameIds(a: string[] = [], b: string[] = []) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

export function servicoKey(it: Pick<ItemServico, "ordemservicoid" | "servicoid">) {
  return `${it.ordemservicoid}-${it.servicoid}`;
}

export function tituloServico(it: ItemServico) {
  return it.servico?.descricao || it.servico?.codigo || `Serviço #${it.servicoid}`;
}

export function baseServico(it: ItemServico) {
  return Number(it.subtotal ?? 0) || Number(it.quantidade ?? 0) * Number(it.precounitario ?? 0);
}

export function idsDoItem(it: ItemServico): string[] {
  return uniq((it.realizadores ?? []).map((r) => r?.id).filter(Boolean) as string[]);
}

/** "Ana, Bruno +2" — resumo curto para caber na linha do serviço. */
export function resumoNomes(ids: string[], usuarios: UsuarioAtivo[], max = 2): string {
  if (ids.length === 0) return "";

  const porId = new Map(usuarios.map((u) => [u.id, u]));
  const nomes = ids.map((id) => nomeDe(porId.get(id), id));
  const visiveis = nomes.slice(0, max).join(", ");
  const resto = nomes.length - max;

  return resto > 0 ? `${visiveis} +${resto}` : visiveis;
}
