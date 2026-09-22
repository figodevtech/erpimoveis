export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { normalizarAjustes } from "@/app/api/transaction/_lib/ajustes";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirAcessoATransacao } from "../../_lib/autoria";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const session = await auth();
    const { id } = await ctx.params;
    await exigirAcessoATransacao(Number(id));
    if (!/^\d+$/.test(id) || id === "0") {
      return NextResponse.json({ error: "Transação inválida." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const dataPagamento = String(body?.dataPagamento ?? "").trim();
    const bancoId = Number(body?.bancoId);
    const metodoPagamento = String(body?.metodoPagamento ?? "").trim();
    const planoContaId = body?.planoContaId == null ? null : Number(body.planoContaId);
    const centroCustoId = body?.centroCustoId == null ? null : Number(body.centroCustoId);
    /*
     * Só título antecipado responde a isto, e só ele oferece a pergunta na tela.
     *
     * Antecipado e honrado no vencimento, a baixa não move a conta: o dinheiro
     * entrou pela antecipação, e gravar o banco de novo somaria o mesmo valor
     * duas vezes. Quando o pagador não paga, porém, o banco debita o valor de
     * volta — e se o devedor quitar depois, aquela baixa é entrada de verdade.
     * Só quem operou sabe em qual dos dois está, então a tela pergunta.
     *
     * O padrão é `false`: o caso comum é o boleto honrado, e quem chamar sem o
     * campo recebe o comportamento de sempre.
     */
    /*
     * Quanto desta baixa entra na conta. Só título antecipado responde.
     *
     * Nele os dois números divergem: o boleto foi pago por inteiro, mas parte do
     * dinheiro já tinha vindo pela antecipação. Zero = o boleto foi honrado e a
     * conta não se move. O líquido inteiro = o banco devolveu tudo e o pagador
     * quitou depois. Um valor no meio = o banco reteve o que adiantou e repassou
     * só o resto, tipicamente o juros do atraso.
     *
     * Ausente é o comportamento de sempre: em título comum o banco é gravado no
     * próprio título; em antecipado, nada entra.
     */
    const valorLancadoBruto = body?.valorLancado;
    const valorLancado =
      valorLancadoBruto == null || valorLancadoBruto === ""
        ? null
        : Number(valorLancadoBruto);
    if (valorLancado != null && (!Number.isFinite(valorLancado) || valorLancado < 0)) {
      return NextResponse.json(
        { error: "O valor lançado na conta deve ser um número não negativo." },
        { status: 400 },
      );
    }
    /*
     * Baixa parcial: quanto deste título está sendo pago agora.
     *
     * Ausente é o comportamento de sempre — baixa o saldo inteiro. Menor que o
     * saldo cria uma transação com o dinheiro, ligada ao título, que segue aberto
     * pelo que falta. Quem valida o teto é a RPC, que é onde o saldo está.
     */
    const valorBruto = body?.valor;
    const valor =
      valorBruto == null || valorBruto === "" ? null : Number(valorBruto);
    if (valor != null && (!Number.isFinite(valor) || valor <= 0)) {
      return NextResponse.json(
        { error: "O valor da baixa deve ser um número maior que zero." },
        { status: 400 },
      );
    }

    /*
     * Acréscimos e descontos lançados no ato da baixa.
     *
     * Aqui só se confere a FORMA. Quem converte percentual em reais e lê a
     * natureza do catálogo é `baixar_transacao_pendente`, que detém o
     * `FOR UPDATE` do título — fazer a conta antes abriria uma janela em que a
     * base lida aqui não é a base travada lá.
     */
    const normalizacao = normalizarAjustes(body?.ajustes);
    if (!normalizacao.ok) {
      return NextResponse.json({ error: normalizacao.erro }, { status: 400 });
    }
    const ajustes = normalizacao.ajustes;

    /*
     * Lançar acréscimo é mexer no valor bruto, e é isso que a config
     * `habilitar_edicao_transacoes` protege. Sem esta checagem a baixa viraria a
     * porta dos fundos para alterar valores num sistema onde o dono desligou a
     * edição. Baixa sem ajuste segue sem checar nada, como sempre foi.
     */
    if (ajustes.length > 0) {
      const bloqueio = await respostaSeEdicaoBloqueada();
      if (bloqueio) return bloqueio;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)) {
      return NextResponse.json({ error: "Informe uma data de pagamento válida." }, { status: 400 });
    }
    const pagoEm = new Date(`${dataPagamento}T12:00:00-03:00`);
    if (Number.isNaN(pagoEm.getTime())) {
      return NextResponse.json({ error: "Informe uma data de pagamento válida." }, { status: 400 });
    }

    /*
     * Crédito do cliente não passa por conta nenhuma: quem paga é a carteira
     * dele. Por isso não exige banco e vai para uma RPC própria — a baixa
     * comum começa exigindo banco e carrega os caminhos de baixa parcial e de
     * repasse do antecipado, que aqui não existem.
     *
     * O desvio mora aqui e não na tela: para quem opera continua sendo o mesmo
     * diálogo, escolhendo a forma de pagamento na mesma lista.
     */
    if (metodoPagamento.toUpperCase() === "CREDITO CLIENTE") {
      /*
       * Recusa explícita, e não silêncio.
       *
       * O crédito do cliente vai para outra RPC, que não conhece `p_ajustes`.
       * Sem esta parada os ajustes seriam descartados no desvio e a pessoa veria
       * "baixado" com o juros que digitou não tendo sido cobrado — o pior
       * resultado possível.
       */
      if (ajustes.length > 0) {
        return NextResponse.json(
          {
            error:
              "O crédito do cliente quita o título pelo valor que ele tem hoje. Lance o acréscimo ou o desconto no título antes de usar a carteira.",
          },
          { status: 400 },
        );
      }

      const { data, error } = await supabaseAdmin.rpc("baixar_com_credito_cliente", {
        p_transacao_id: id,
        p_pago_em: pagoEm.toISOString(),
        p_plano_de_conta_id: Number.isSafeInteger(planoContaId) ? planoContaId : null,
        p_centro_custo_id: Number.isSafeInteger(centroCustoId) ? centroCustoId : null,
        p_baixado_por: (session?.user as any)?.id ?? null,
      });

      if (error) {
        if (error.code === "23505") {
          return NextResponse.json({ error: "Esta transação já foi baixada." }, { status: 409 });
        }
        // Saldo insuficiente, título sem cliente, título já pago em partes: a
        // RPC recusa cada um com a mensagem pronta.
        if (error.code === "22023") {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error.code === "P0002") {
          return NextResponse.json({ error: "Transação ou cliente não encontrado." }, { status: 404 });
        }
        throw error;
      }

      return NextResponse.json({ data });
    }

    if (!Number.isSafeInteger(bancoId) || bancoId <= 0 || !metodoPagamento) {
      return NextResponse.json({ error: "Banco e método de pagamento são obrigatórios." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("baixar_transacao_pendente", {
      p_transacao_id: id,
      p_pago_em: pagoEm.toISOString(),
      p_banco_id: bancoId,
      p_metodopagamento: metodoPagamento,
      p_plano_de_conta_id: Number.isSafeInteger(planoContaId) ? planoContaId : null,
      p_centro_custo_id: Number.isSafeInteger(centroCustoId) ? centroCustoId : null,
      p_baixado_por: (session?.user as any)?.id ?? null,
      p_valor: valor,
      p_valor_lancado: valorLancado,
      p_ajustes: ajustes.length > 0 ? ajustes : null,
    });

    if (error) {
      if (error.code === "23505" || error.message.includes("ja foi baixada")) {
        return NextResponse.json({ error: "Esta transação já foi baixada." }, { status: 409 });
      }
      // A RPC recusa a bandeira em título comum com mensagem pronta, e o mesmo
      // código cobre as demais recusas de regra dela.
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
      }
      if (error.code === "23503") {
        return NextResponse.json({ error: "Banco, plano de conta ou centro de custo inválido." }, { status: 422 });
      }
      throw error;
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    const status = statusCode === 401 || statusCode === 403 ? statusCode : 500;
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível baixar a transação." },
      { status },
    );
  }
}
