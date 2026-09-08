export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroCreate } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { LIMITE_SELECAO_EVENTOS } from "@/lib/financeiro/eventos-financeiros-selection";
import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { erroDeBancoNoLancamento } from "@/lib/financeiro/banco-lancamento";

/** Teto de segurança: seleção maior que isso é engano, não operação. */
const LIMITE_PARCELAS = 60;

type LinhaDaParcela = {
  parcela: number;
  total_parcelas: number;
  valor: number;
  valor_liquido: number;
  vencimento_em: string | null;
};

/** Data de vencimento como dia puro, do jeito que a RPC espera. */
function paraDia(valor: unknown): string | null {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(data.getTime())) return null;
  return data.toISOString();
}

/**
 * Lança uma ou mais despesas de serviço da OS no financeiro, como um pagamento
 * só — o boleto do terceirizado que cobrou dois serviços de uma vez.
 *
 * O cliente manda a SELEÇÃO e a divisão em parcelas; quem decide o valor é o
 * servidor, que relê as despesas na fonte. Uma tela aberta há dez minutos
 * lançaria um total que já não corresponde às despesas — mesma regra do
 * pagamento múltiplo.
 */
export async function POST(req: NextRequest) {
  try {
    await requireFinanceiroCreate();

    const body = await req.json().catch(() => ({}));

    // A OS é opcional: o painel da própria OS a informa e continua preso a ela,
    // mas a lista do financeiro atravessa ordens — o boleto do terceirizado que
    // cobra os serviços de três carros de uma vez. Sem ela, a ordem de cada
    // despesa vem do próprio evento, e é o servidor quem descobre se são uma ou
    // várias. Mesma regra na RPC.
    const ordemServicoInformada = body?.ordemServicoId != null;
    const ordemServicoId = Number(body?.ordemServicoId);
    if (
      ordemServicoInformada
      && (!Number.isSafeInteger(ordemServicoId) || ordemServicoId <= 0)
    ) {
      return NextResponse.json({ error: "A ordem de serviço informada é inválida." }, { status: 400 });
    }

    const eventosIds = [
      ...new Set(
        (Array.isArray(body?.eventosIds) ? body.eventosIds : [])
          .map((id: unknown) => Number(id))
          .filter((id: number) => Number.isSafeInteger(id) && id > 0),
      ),
    ] as number[];

    if (eventosIds.length === 0) {
      return NextResponse.json(
        { error: "Selecione ao menos uma despesa para lançar." },
        { status: 400 },
      );
    }
    if (eventosIds.length > LIMITE_SELECAO_EVENTOS) {
      return NextResponse.json(
        { error: `Selecione no máximo ${LIMITE_SELECAO_EVENTOS} despesas por lançamento.` },
        { status: 400 },
      );
    }

    // O valor vem da fonte, não da tela. A RPC revalida com as despesas
    // travadas; aqui a leitura serve para montar as parcelas e para devolver uma
    // mensagem em português antes de chegar ao banco.
    const { data: eventos, error: erroEventos } = await supabaseAdmin
      .from("eventos_financeiros")
      .select("id, ordemservicoid, source_type, source_id, origem, natureza, status, transacaoid, lancamento_id, pode_gerar_transacao, valor, descricao")
      .in("id", eventosIds);

    if (erroEventos) throw erroEventos;

    const faltando = eventosIds.filter(
      (id) => !(eventos ?? []).some((evento: any) => Number(evento.id) === id),
    );
    if (faltando.length > 0) {
      return NextResponse.json(
        {
          error: `Despesa(s) não encontrada(s): ${faltando.map((id) => `#${id}`).join(", ")}.`,
        },
        { status: 404 },
      );
    }

    /** Aceita despesas de OS e comissões de vendas; entradas e transações avulsas ficam fora. */
    const foraDaOs = (evento: any) =>
      ordemServicoInformada
        ? Number(evento.ordemservicoid) !== ordemServicoId
        : evento.ordemservicoid == null && !(evento.source_type === "VENDA" && evento.origem === "COMISSAO" && evento.source_id != null);

    const problema = (eventos ?? []).find((evento: any) => {
      if (foraDaOs(evento)) return true;
      if (String(evento.natureza) !== "DESPESA") return true;
      if (String(evento.status) !== "ATIVO") return true;
      if (evento.transacaoid != null || evento.lancamento_id != null) return true;
      if (evento.pode_gerar_transacao !== true) return true;
      return false;
    }) as any;

    if (problema) {
      const motivo =
        foraDaOs(problema)
          ? ordemServicoInformada
            ? "não pertence a esta OS"
            : "não pertence a uma OS ou comissão de venda"
          : String(problema.natureza) !== "DESPESA"
            ? "não é uma despesa"
            : problema.pode_gerar_transacao !== true
              ? "é um lançamento automático e não gera transação"
              : "já foi lançada no financeiro";
      return NextResponse.json(
        { error: `A despesa "${problema.descricao ?? problema.id}" ${motivo}.` },
        { status: 409 },
      );
    }

    const totalEmCentavos = (eventos ?? []).reduce(
      (soma: number, evento: any) => soma + paraCentavos(evento.valor),
      0,
    );
    if (totalEmCentavos <= 0) {
      return NextResponse.json(
        { error: "A soma das despesas selecionadas precisa ser maior que zero." },
        { status: 400 },
      );
    }

    // As parcelas vêm da tela porque o vencimento e a divisão são escolha do
    // operador — o que o servidor impõe é que somem exatamente o total.
    const parcelasRecebidas = Array.isArray(body?.parcelas) ? body.parcelas : [];
    if (parcelasRecebidas.length > LIMITE_PARCELAS) {
      return NextResponse.json(
        { error: `Informe no máximo ${LIMITE_PARCELAS} parcelas.` },
        { status: 400 },
      );
    }

    let linhas: LinhaDaParcela[];

    if (parcelasRecebidas.length > 1) {
      const soma = parcelasRecebidas.reduce(
        (acc: number, parcela: any) => acc + paraCentavos(parcela?.valor),
        0,
      );
      if (soma !== totalEmCentavos) {
        return NextResponse.json(
          {
            error: `A soma das parcelas (${paraReais(soma)}) precisa ser igual à soma das despesas selecionadas (${paraReais(totalEmCentavos)}).`,
          },
          { status: 409 },
        );
      }

      const semVencimento = parcelasRecebidas.some((parcela: any) => !paraDia(parcela?.data));
      if (semVencimento) {
        return NextResponse.json(
          { error: "Informe o vencimento de todas as parcelas." },
          { status: 400 },
        );
      }

      linhas = parcelasRecebidas.map((parcela: any, indice: number) => ({
        parcela: indice + 1,
        total_parcelas: parcelasRecebidas.length,
        valor: paraReais(paraCentavos(parcela?.valor)),
        valor_liquido: paraReais(paraCentavos(parcela?.valor)),
        vencimento_em: paraDia(parcela?.data),
      }));
    } else {
      linhas = [
        {
          parcela: 1,
          total_parcelas: 1,
          valor: paraReais(totalEmCentavos),
          valor_liquido: paraReais(totalEmCentavos),
          vencimento_em: paraDia(parcelasRecebidas[0]?.data ?? body?.data),
        },
      ];
    }

    const pendente = body?.pendente !== false;
    if (erroDeBancoNoLancamento({ pendente, banco_id: body?.bancoId })) {
      return NextResponse.json(
        { error: "Informe o banco que pagou a despesa." },
        { status: 400 },
      );
    }

    const session = await auth().catch(() => null);
    const createdBy = (session?.user as { id?: string } | undefined)?.id ?? null;

    const { data, error } = await supabaseAdmin.rpc("registrar_lancamento_de_eventos", {
      p_payload: {
        ordemservicoid: ordemServicoInformada ? ordemServicoId : null,
        eventos_ids: eventosIds,
        descricao: String(body?.descricao ?? "").trim() || null,
        data: paraDia(body?.data) ?? new Date().toISOString(),
        pendente,
        metodopagamento: String(body?.metodoPagamento ?? "").trim() || null,
        categoria: String(body?.categoria ?? "").trim() || null,
        categoria_id: body?.categoriaId ?? null,
        plano_de_conta_id: body?.planoDeContaId ?? null,
        centro_custo_id: body?.centroCustoId ?? null,
        fornecedor_id: body?.fornecedorId ?? null,
        banco_id: body?.bancoId ?? null,
        nomepagador: String(body?.nomePagador ?? "").trim() || null,
        cpfcnpjpagador: String(body?.cpfCnpjPagador ?? "").trim() || null,
        created_by: createdBy,
        linhas,
      },
    });

    if (error) {
      // P0001 é regra de negócio da RPC (despesa já lançada, soma que não fecha):
      // é erro do pedido, não falha do servidor.
      const status = error.code === "P0001" ? 409 : error.code === "P0002" ? 404 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json(
      {
        data: {
          id: Number(data),
          parcelas: linhas.length,
          despesas: eventosIds.length,
        },
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível registrar o lançamento." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
