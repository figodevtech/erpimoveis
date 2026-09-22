import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { podeVerTodasTransacoes } from "@/app/api/_authz/perms";
import { decidirRecorte, type RecorteDeAutoria } from "./autoria-regra";

/**
 * Quem ve o que na listagem do fluxo de caixa.
 *
 * Fonte unica da regra: lista, KPIs, exportacao e as rotas de uma transacao so
 * precisam concordar entre si. Quando divergiam, o cartao somava um recorte e a
 * tabela mostrava outro — e a planilha entregava o que a tela escondia.
 *
 * A decisao em si mora em `./autoria-regra`, que nao importa sessao nem banco e
 * por isso pode ser testada.
 */
export {
  aplicarRecorteDeAutoria,
  expressaoDeAutoria,
  leApenasMinhas,
  type RecorteDeAutoria,
} from "./autoria-regra";

/** O id do dono vem sempre da sessao. Nunca do corpo nem da query. */
async function usuarioDaSessao(): Promise<string | null> {
  const session = await auth();
  return ((session?.user as { id?: string } | undefined)?.id as string | undefined) ?? null;
}

export async function recorteDeAutoria(apenasMinhas: boolean): Promise<RecorteDeAutoria> {
  const podeVerTudo = await podeVerTodasTransacoes();
  if (podeVerTudo && !apenasMinhas) return decidirRecorte(true, false, null);
  return decidirRecorte(podeVerTudo, apenasMinhas, await usuarioDaSessao());
}

function erro403(mensagem: string) {
  const erro = new Error(mensagem);
  (erro as { statusCode?: number }).statusCode = 403;
  return erro;
}

/**
 * Barra o acesso direto a uma transacao de outra pessoa.
 *
 * A lista esconder a linha nao basta: sem isto bastava saber o id para abrir,
 * editar ou excluir pela rota. Como `created_by IS NULL` continua sendo de
 * todos, hoje isto so morde transacao que ja nasceu com dono — e passa a valer
 * de verdade conforme os lancamentos novos forem sendo carimbados.
 */
export async function exigirAcessoATransacao(
  // Aceita string porque nem todo handler converte o id da rota antes de
  // chegar aqui — `parseId` de algumas rotas devolve o texto cru.
  ids: number | string | Array<number | string>,
): Promise<void> {
  const lista = (Array.isArray(ids) ? ids : [ids])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  if (lista.length === 0) return;

  if (await podeVerTodasTransacoes()) return;

  const usuarioId = await usuarioDaSessao();

  const { data, error } = await supabaseAdmin
    .from("transacao")
    .select("id, created_by")
    .in("id", lista);

  if (error) throw error;

  // Id inexistente nao e assunto desta checagem: quem responde 404 e o handler.
  const alheias = (data ?? []).filter(
    (linha: { created_by: string | null }) =>
      linha.created_by != null && linha.created_by !== usuarioId,
  );

  if (alheias.length === 0) return;

  throw erro403(
    alheias.length === 1
      ? `A transação #${alheias[0].id} foi criada por outra pessoa.`
      : `${alheias.length} das transações selecionadas foram criadas por outras pessoas.`,
  );
}
