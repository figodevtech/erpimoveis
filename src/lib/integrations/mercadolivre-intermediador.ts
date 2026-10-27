import { CNPJ_INTERMEDIADOR_MERCADO_LIVRE, type NFeIntermediador } from "@/lib/nfe/intermediador";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function vendaDoMercadoLivre(canal: unknown) {
  return String(canal ?? "").trim().toUpperCase() === "MERCADO_LIVRE";
}

/**
 * Intermediador da NF-e de uma venda do Mercado Livre: o CNPJ do ML e o
 * cadastro do vendedor nele — o apelido da conta, como o ML orienta.
 *
 * A conta vem do pedido importado. Venda lançada à mão com canal Mercado
 * Livre não tem pedido; aí vale a conta conectada. Sem conta nenhuma não há
 * como identificar o vendedor, e a nota não pode sair dizendo que passou pela
 * plataforma sem dizer quem vendeu.
 */
export async function intermediadorDaVendaMercadoLivre(vendaId: number): Promise<NFeIntermediador> {
  const { data: pedido, error: pedidoError } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("account_id, raw_order")
    .eq("venda_id", vendaId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pedidoError) throw pedidoError;

  let contaQuery = supabaseAdmin
    .from("mercadolivre_account")
    .select("nickname, ml_user_id")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (pedido?.account_id) contaQuery = contaQuery.eq("id", pedido.account_id);
  const { data: conta, error: contaError } = await contaQuery.maybeSingle();
  if (contaError) throw contaError;

  const vendedor = (pedido?.raw_order as { seller?: { id?: unknown; nickname?: unknown } } | null)?.seller;
  const idCadIntTran = [conta?.nickname, vendedor?.nickname, conta?.ml_user_id, vendedor?.id]
    .map((valor) => String(valor ?? "").trim())
    .find((valor) => valor.length >= 2);
  if (!idCadIntTran) {
    throw new Error(
      "Venda do Mercado Livre sem conta conectada: não há como informar o vendedor como intermediador na NF-e. " +
        "Conecte a conta do Mercado Livre em Marketplace e tente de novo.",
    );
  }

  return { cnpj: CNPJ_INTERMEDIADOR_MERCADO_LIVRE, idCadIntTran: idCadIntTran.slice(0, 60) };
}
