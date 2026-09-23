import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hasOSAccess, hasVendasAccess, podeVerTodasTransacoes } from "@/app/api/_authz/perms";
import {
  decidirRecorte,
  podeAlterarTransacao,
  podeLerTransacao,
  type DocumentoDoPagamento,
  type RecorteDeAutoria,
} from "./autoria-regra";

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
  podeAlterarTransacao,
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
 * Quem pode alterar o que, para quem precisa decidir linha a linha (a aba
 * Financeiro da OS marca o que abre so para leitura).
 */
export async function criterioDeAlteracao(): Promise<(createdBy: string | null) => boolean> {
  if (await podeVerTodasTransacoes()) return () => true;
  const usuarioId = await usuarioDaSessao();
  return (createdBy) => podeAlterarTransacao({ podeVerTudo: false, usuarioId, createdBy });
}

function normalizarIds(ids: number | string | Array<number | string>): number[] {
  return (Array.isArray(ids) ? ids : [ids])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
}

async function donosDasTransacoes(lista: number[]) {
  const { data, error } = await supabaseAdmin
    .from("transacao")
    .select("id, created_by, ordemservicoid, vendaid")
    .in("id", lista);

  if (error) throw error;
  return (data ?? []) as Array<{
    id: number;
    created_by: string | null;
    ordemservicoid: number | null;
    vendaid: number | null;
  }>;
}

function recusar(alheias: Array<{ id: number }>): never {
  throw erro403(
    alheias.length === 1
      ? `A transação #${alheias[0].id} foi criada por outra pessoa.`
      : `${alheias.length} das transações selecionadas foram criadas por outras pessoas.`,
  );
}

/**
 * Barra o acesso direto a uma transacao de outra pessoa.
 *
 * A lista esconder a linha nao basta: sem isto bastava saber o id para abrir,
 * editar ou excluir pela rota. Como `created_by IS NULL` continua sendo de
 * todos, isto so morde transacao que nasceu com dono.
 *
 * Vale para escrita. Os GET usam `exigirLeituraDeTransacao`, que tambem abre a
 * transacao de OS.
 */
export async function exigirAcessoATransacao(
  // Aceita string porque nem todo handler converte o id da rota antes de
  // chegar aqui — `parseId` de algumas rotas devolve o texto cru.
  ids: number | string | Array<number | string>,
): Promise<void> {
  const lista = normalizarIds(ids);
  if (lista.length === 0) return;

  if (await podeVerTodasTransacoes()) return;

  const usuarioId = await usuarioDaSessao();

  // Id inexistente nao e assunto desta checagem: quem responde 404 e o handler.
  const alheias = (await donosDasTransacoes(lista)).filter(
    (linha) => !podeAlterarTransacao({ podeVerTudo: false, usuarioId, createdBy: linha.created_by }),
  );

  if (alheias.length > 0) recusar(alheias);
}

/**
 * Como `exigirAcessoATransacao`, mas para abrir sem alterar: a transacao alheia
 * que e pagamento de uma OS abre para quem acessa OS, e a de uma venda para
 * quem acessa vendas. A aba Financeiro da OS e as telas de pagamento ja as
 * listam — sem isto o clique na linha visivel virava 403.
 *
 * "Pagamento de" segue o mesmo criterio dessas telas: `ordemservicoid` /
 * `vendaid`, ou o rateio de um pagamento multiplo que cobre o documento.
 */
export async function exigirLeituraDeTransacao(
  ids: number | string | Array<number | string>,
): Promise<void> {
  const lista = normalizarIds(ids);
  if (lista.length === 0) return;

  if (await podeVerTodasTransacoes()) return;

  const usuarioId = await usuarioDaSessao();
  const linhas = await donosDasTransacoes(lista);
  const semAlterar = linhas.filter(
    (linha) => !podeAlterarTransacao({ podeVerTudo: false, usuarioId, createdBy: linha.created_by }),
  );
  if (semAlterar.length === 0) return;

  const [acessoAOs, acessoAVendas] = await Promise.all([hasOSAccess(), hasVendasAccess()]);
  const acessoA: Record<DocumentoDoPagamento, boolean> = { OS: acessoAOs, VENDA: acessoAVendas };

  const documentos = new Map<number, Set<DocumentoDoPagamento>>();
  for (const linha of semAlterar) {
    const conjunto = new Set<DocumentoDoPagamento>();
    if (linha.ordemservicoid != null) conjunto.add("OS");
    if (linha.vendaid != null) conjunto.add("VENDA");
    documentos.set(linha.id, conjunto);
  }

  // O rateio so importa se abrir alguma coisa: sem acesso a nenhum dos dois
  // modulos, a resposta ja e 403.
  if (acessoAOs || acessoAVendas) {
    const { data, error } = await supabaseAdmin
      .from("pagamento_multiplo_rateio")
      .select("transacao_id, tipo_documento")
      .in("transacao_id", semAlterar.map((linha) => linha.id));
    if (error) throw error;
    for (const linha of (data ?? []) as Array<{ transacao_id: number; tipo_documento: DocumentoDoPagamento }>) {
      documentos.get(Number(linha.transacao_id))?.add(linha.tipo_documento);
    }
  }

  const alheias = semAlterar.filter(
    (linha) =>
      !podeLerTransacao({
        podeVerTudo: false,
        usuarioId,
        createdBy: linha.created_by,
        documentos: [...(documentos.get(linha.id) ?? [])],
        acessoA,
      }),
  );

  if (alheias.length > 0) recusar(alheias);
}
