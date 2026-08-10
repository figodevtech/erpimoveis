import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const STATUS_OS_QUE_EXCLUEM_TRANSACOES = [
  "ORCAMENTO",
  "CANCELADO",
  "SEM_COBRANCA",
] as const;

export function statusExcluiTransacoesFinanceirasOs(status: unknown) {
  return STATUS_OS_QUE_EXCLUEM_TRANSACOES.includes(
    String(status ?? "").toUpperCase() as (typeof STATUS_OS_QUE_EXCLUEM_TRANSACOES)[number],
  );
}

/**
 * Filtro único dos lançamentos removidos ao reverter/cancelar a OS.
 * Eventos econômicos de produtos, serviços, frete e comissão ficam fora.
 */
export function filtrarTransacoesExcluiveisDaOs(query: any, osId: number) {
  return query
    .eq("ordemservicoid", osId)
    .eq("tipo", "RECEITA")
    .is("evento_financeiro_id", null)
    .eq("is_deleted", false);
}

export function normalizarIdsTransacoes(input: unknown): string[] | null {
  if (input === undefined) return null;
  if (!Array.isArray(input)) {
    const error = new Error("A lista de transações financeiras esperadas é inválida.");
    (error as any).statusCode = 400;
    throw error;
  }

  const ids = input.map((id) => String(id ?? "").trim());
  if (ids.some((id) => !/^\d+$/.test(id) || id === "0")) {
    const error = new Error("A lista de transações financeiras esperadas é inválida.");
    (error as any).statusCode = 400;
    throw error;
  }

  return Array.from(new Set(ids)).sort((a, b) => {
    const esquerda = BigInt(a);
    const direita = BigInt(b);
    return esquerda < direita ? -1 : esquerda > direita ? 1 : 0;
  });
}

export async function validarSnapshotTransacoesDaOs(
  osId: number,
  idsEsperadosInput: unknown,
) {
  const idsEsperados = normalizarIdsTransacoes(idsEsperadosInput);
  const consulta = filtrarTransacoesExcluiveisDaOs(
    supabaseAdmin.from("transacao").select("id"),
    osId,
  );
  const { data, error } = await consulta;
  if (error) throw error;

  const idsAtuais = normalizarIdsTransacoes((data ?? []).map((item: any) => item.id)) ?? [];
  if (
    idsEsperados !== null &&
    (idsEsperados.length !== idsAtuais.length ||
      idsEsperados.some((id, index) => id !== idsAtuais[index]))
  ) {
    const snapshotError = new Error(
      "A lista de pagamentos e títulos da OS mudou. Revise os lançamentos antes de confirmar novamente.",
    );
    (snapshotError as any).statusCode = 409;
    (snapshotError as any).codigo = "TRANSACOES_FINANCEIRAS_ALTERADAS";
    throw snapshotError;
  }

  return idsAtuais;
}
