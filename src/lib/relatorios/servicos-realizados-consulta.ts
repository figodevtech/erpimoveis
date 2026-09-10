import { limitesPeriodo, type FiltrosServicos } from "./servicos-realizados";

// Interface mínima do builder para validar o recorte sem depender de um banco real.
export interface ConsultaServicos<T> {
  eq(coluna: string, valor: string | number | boolean): T;
  is(coluna: string, valor: null): T;
  in(coluna: string, valores: string[]): T;
  gte(coluna: string, valor: string): T;
  lt(coluna: string, valor: string): T;
  order(coluna: string, opcoes: { ascending: boolean }): T;
}
export interface ConsultaPaginadaServicos extends ConsultaServicos<ConsultaPaginadaServicos> {
  range(inicio: number, fim: number): PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
}
export function aplicarFiltrosServicos<T extends ConsultaServicos<T>>(query: T, f: FiltrosServicos): T {
  let q = query.eq("item.ordem.is_deleted", false);
  if (f.status.length) q = q.in("item.ordem.status", f.status);
  if (f.criadorId) q = q.eq("item.ordem.usuariocriadorid", f.criadorId);
  if (f.realizadorId) q = q.eq("usuarioid", f.realizadorId);
  if (f.setorId === "SEM_SETOR") q = q.is("item.ordem.setorid", null);
  else if (f.setorId) q = q.eq("item.ordem.setorid", Number(f.setorId));
  if (f.ordemId) q = q.eq("ordemservicoid", Number(f.ordemId));
  if (f.clienteId) q = q.eq("item.ordem.clienteid", Number(f.clienteId));
  if (f.situacao) q = q.eq("status_execucao", f.situacao);
  const coluna = f.campoData === "servico" ? "finalizado_em" : f.campoData === "conclusao" ? "item.ordem.execucao_fim_em" : "item.ordem.dataentrada";
  const periodo = limitesPeriodo(f);
  if (periodo.inicio) q = q.gte(coluna, periodo.inicio);
  if (periodo.fim) q = q.lt(coluna, periodo.fim);
  return q.order("ordemservicoid", { ascending: true }).order("servicoid", { ascending: true }).order("usuarioid", { ascending: true });
}
