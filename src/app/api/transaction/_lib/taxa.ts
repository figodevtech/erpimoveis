import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Traduz "quero que entre X na conta" na linha de taxa de recebimento.
 *
 * Depois que o desconto virou linha, `valorLiquido` deixou de ser campo
 * gravavel: o gatilho `transacao_valor_coerente_trg` o recalcula como
 * `valor - descontos` em toda escrita. Quem tenta gravar o liquido direto —
 * o PATCH da edicao, a RPC de rateio — tem o valor descartado em silencio.
 *
 * Esta funcao e o unico caminho para mexer no liquido: ela ajusta a linha de
 * TAXA_RECEBIMENTO, e o gatilho deriva o liquido a partir dela.
 *
 * So atua quando a taxa e o unico desconto. Havendo outros, nao da para saber
 * qual o usuario quis mexer, e escolher um transformaria desconto comercial em
 * taxa de maquineta.
 */
export type ResultadoDaTaxa =
  | { ok: true }
  | { ok: false; erro: string; status: number };

export async function sincronizarTaxaRecebimento(
  transacaoId: number,
  liquidoDesejado: number,
  usuarioId?: string | null,
): Promise<ResultadoDaTaxa> {
  const { data: transacao, error: transacaoError } = await supabaseAdmin
    .from("transacao")
    .select("id, valor")
    .eq("id", transacaoId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (transacaoError) throw transacaoError;
  if (!transacao) {
    return { ok: false, erro: "Transação não encontrada.", status: 404 };
  }

  const { data: descontos, error: descontosError } = await supabaseAdmin
    .from("transacao_ajuste")
    .select("id, tipo:tipos_ajuste_transacao!transacao_ajuste_tipo_id_fkey ( codigo_sistema )")
    .eq("transacao_id", transacaoId)
    .eq("natureza", "DESCONTO");

  if (descontosError) throw descontosError;

  const linhas = descontos ?? [];
  const taxaExistente = linhas.find(
    (linha) =>
      (linha.tipo as unknown as { codigo_sistema?: string | null } | null)
        ?.codigo_sistema === "TAXA_RECEBIMENTO",
  );

  if (linhas.length > 1 || (linhas.length === 1 && !taxaExistente)) {
    return {
      ok: false,
      erro:
        "Esta transação tem mais de um desconto. Ajuste pela aba Acréscimos e descontos.",
      status: 409,
    };
  }

  const bruto = Number(transacao.valor ?? 0);
  const taxa = Math.round((bruto - liquidoDesejado) * 100) / 100;

  if (taxa < 0) {
    return {
      ok: false,
      erro: "O valor líquido não pode ser maior que o bruto.",
      status: 400,
    };
  }

  // Liquido igual ao bruto significa "sem taxa": a linha deixa de existir.
  if (taxa === 0) {
    if (taxaExistente) {
      const { error } = await supabaseAdmin
        .from("transacao_ajuste")
        .delete()
        .eq("id", taxaExistente.id);
      if (error) throw error;
    }
    return { ok: true };
  }

  if (taxaExistente) {
    const { error } = await supabaseAdmin
      .from("transacao_ajuste")
      .update({ modo: "FIXO", valor_informado: taxa, valor_calculado: taxa })
      .eq("id", taxaExistente.id);
    if (error) throw error;
    return { ok: true };
  }

  const { data: tipo, error: tipoError } = await supabaseAdmin
    .from("tipos_ajuste_transacao")
    .select("id")
    .eq("codigo_sistema", "TAXA_RECEBIMENTO")
    .maybeSingle();

  if (tipoError) throw tipoError;
  if (!tipo) {
    return {
      ok: false,
      erro: "O tipo Taxa de recebimento não está cadastrado.",
      status: 409,
    };
  }

  const { error } = await supabaseAdmin.from("transacao_ajuste").insert({
    transacao_id: transacaoId,
    tipo_id: tipo.id,
    natureza: "DESCONTO",
    modo: "FIXO",
    valor_informado: taxa,
    valor_calculado: taxa,
    created_by: usuarioId ?? null,
  });
  if (error) throw error;

  return { ok: true };
}
