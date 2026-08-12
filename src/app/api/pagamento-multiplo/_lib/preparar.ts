import {
  RateioInvalidoError,
  paraCentavos,
  paraReais,
  ratearEmParcelas,
  ratearEntreDocumentos,
} from "@/lib/financeiro/rateio";
import { calcularResumoFinanceiroOs } from "@/lib/ordens/financeiro";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type TipoDocumento = "OS" | "VENDA";

export type LinhaDoRateio = {
  documento_id: number;
  valor: number;
  parcela: number;
  total_parcelas: number;
  vencimento_em: string | null;
};

/**
 * Saldo em aberto de cada documento, na fonte.
 *
 * O cliente manda a seleção, nunca os valores: quem decide quanto cada documento
 * ainda deve é o servidor. Uma tela desatualizada — outro operador acabou de
 * receber a mesma OS — abateria valor que já não existe.
 *
 * OS e venda usam a MESMA função de resumo (`calcularResumoFinanceiroOs`): ela só
 * tem nome de OS, o cálculo é sobre total comercial + acréscimo financeiro +
 * transações, que a venda também tem.
 */
export async function carregarSaldos(tipo: TipoDocumento, ids: number[]) {
  const tabela = tipo === "OS" ? "ordemservico" : "venda";
  const colunaTotal = tipo === "OS" ? "orcamentototal" : "valortotal";

  const [documentos, recebimentos] = await Promise.all([
    supabaseAdmin
      .from(tabela)
      .select(
        `id, status, clienteid, ${colunaTotal}, acrescimo_financeiro_tipo, acrescimo_financeiro_valor`,
      )
      .in("id", ids),
    // A view soma o vínculo direto e o rateio do pagamento múltiplo. Ler só
    // `transacao.ordemservicoid` deixaria de fora o que já foi pago em grupo, e o
    // documento apareceria em aberto duas vezes.
    supabaseAdmin
      .from("recebimento_por_documento")
      .select("documento_id, valor, pendente")
      .eq("tipo_documento", tipo)
      .in("documento_id", ids),
  ]);

  if (documentos.error) throw documentos.error;
  if (recebimentos.error) throw recebimentos.error;

  const porDocumento = new Map<number, any[]>();
  for (const recebimento of (recebimentos.data ?? []) as any[]) {
    const documentoId = Number(recebimento.documento_id);
    // `calcularResumoFinanceiroOs` espera o formato de transação; a fatia da view
    // já é valor de face, então o acréscimo entra zerado.
    const linha = {
      tipo: "RECEITA",
      pendente: recebimento.pendente === true,
      valor: recebimento.valor,
      valor_acrescimos: 0,
      evento_financeiro_id: null,
    };
    const atual = porDocumento.get(documentoId);
    if (atual) atual.push(linha);
    else porDocumento.set(documentoId, [linha]);
  }

  return (documentos.data ?? []).map((documento: any) => {
    const resumo = calcularResumoFinanceiroOs({
      totalComercial: documento[colunaTotal],
      acrescimoFinanceiroTipo: documento.acrescimo_financeiro_tipo,
      acrescimoFinanceiroValor: documento.acrescimo_financeiro_valor,
      transacoes: porDocumento.get(Number(documento.id)) ?? [],
    });

    return {
      id: Number(documento.id),
      status: String(documento.status ?? "").toUpperCase(),
      clienteId: documento.clienteid == null ? null : Number(documento.clienteid),
      saldoEmCentavos: paraCentavos(resumo.saldoDisponivelParaLancamento),
    };
  });
}

/** Vencimento da parcela `n`, mês a mês a partir da primeira. */
function vencimentoDaParcela(primeiroVencimento: string, indice: number) {
  const [ano, mes, dia] = primeiroVencimento.split("-").map(Number);
  const data = new Date(ano, mes - 1 + indice, dia, 12, 0, 0);
  return data.toISOString();
}

/**
 * Monta as linhas que a RPC vai gravar: uma por documento no à vista, uma por
 * documento e parcela no parcelado.
 */
export function montarLinhas({
  documentos,
  valorEmCentavos,
  quantidadeDeParcelas,
  primeiroVencimento,
}: {
  documentos: Array<{ id: number; saldoEmCentavos: number }>;
  valorEmCentavos: number;
  quantidadeDeParcelas: number;
  primeiroVencimento: string | null;
}): LinhaDoRateio[] {
  if (quantidadeDeParcelas <= 1) {
    return ratearEntreDocumentos(documentos, valorEmCentavos).map((fatia) => ({
      documento_id: fatia.id,
      valor: paraReais(fatia.valorEmCentavos),
      parcela: 1,
      total_parcelas: 1,
      vencimento_em: null,
    }));
  }

  if (!primeiroVencimento) {
    throw new RateioInvalidoError("Informe o vencimento da primeira parcela.");
  }

  return ratearEmParcelas(documentos, valorEmCentavos, quantidadeDeParcelas).map((linha) => ({
    documento_id: linha.id,
    valor: paraReais(linha.valorEmCentavos),
    parcela: linha.parcela,
    total_parcelas: quantidadeDeParcelas,
    vencimento_em: vencimentoDaParcela(primeiroVencimento, linha.parcela - 1),
  }));
}
