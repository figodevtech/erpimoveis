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
 * So MUDA o liquido quando a taxa e o unico desconto. Havendo outros, nao da
 * para saber qual o usuario quis mexer, e escolher um transformaria desconto
 * comercial em taxa de maquineta — entao recusa. Pedir o liquido que a
 * transacao ja tem, porem, nao e mudanca nenhuma: sai como sucesso.
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
    .select('id, valor, "valorLiquido", valor_descontos')
    .eq("id", transacaoId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (transacaoError) throw transacaoError;
  if (!transacao) {
    return { ok: false, erro: "Transação não encontrada.", status: 404 };
  }

  const bruto = Number(transacao.valor ?? 0);

  /*
   * Pedir o líquido que já está lá não é pedir nada.
   *
   * `/ajustar-valores` chama esta função para TODA linha que ajustou, mesmo as
   * que só tiveram o bruto mexido — e no rateio, mesmo as que não foram tocadas.
   * Havendo desconto lançado, o gatilho já deixou o líquido em `valor -
   * descontos`, que é exatamente o número que a tela mandou de volta. Sem esta
   * saída, essas linhas caíam na recusa logo abaixo e o usuário via "os valores
   * brutos foram salvos, mas o líquido não pôde ser ajustado" ao fim de um
   * salvamento que tinha dado certo por inteiro.
   *
   * Recusar continua valendo para quem quer MUDAR o líquido de uma transação com
   * desconto que não é a taxa. Aí há de fato uma escolha impossível de adivinhar.
   */
  const descontosAtuais = Number(transacao.valor_descontos ?? 0);
  const liquidoGravado = Number(transacao.valorLiquido ?? 0);
  const liquidoAtual =
    descontosAtuais > 0
      ? Math.round((bruto - descontosAtuais) * 100) / 100
      : liquidoGravado > 0
        ? liquidoGravado
        : bruto;

  if (Math.round(liquidoAtual * 100) === Math.round(liquidoDesejado * 100)) {
    return { ok: true };
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
