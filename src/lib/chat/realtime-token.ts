// src/lib/chat/realtime-token.ts

/**
 * Credencial de Realtime do chat.
 *
 * O canal do chat e privado e o servidor valida o JWT emitido por
 * `/api/chat/realtime-token` a cada join. O `subscribe()` do realtime-js chama
 * `socket.setAuth()` sem argumento em todo join bem-sucedido, e o
 * `SupabaseClient` responde a essa chamada com o anon key quando nao existe
 * sessao do Supabase Auth -- o que substituiria o token do chat e faria o
 * servidor recusar todo rejoin posterior. Por isso o cliente e criado com este
 * modulo como fonte de token: e ele que responde aquela chamada interna.
 *
 * Como o supabase nao aguarda a promessa daquela chamada, nenhuma funcao aqui
 * lanca: em caso de falha, devolvemos o ultimo token conhecido e deixamos a
 * reconexao do provider tratar o erro pelo caminho que sabe reporta-lo.
 */

export type ChatRealtimeCredentials = { token: string; expiresAt: string };

type ChatRealtimeTokenSource = () => Promise<ChatRealtimeCredentials>;

/** Renova com folga: um token que expira durante o join ja nasce recusado. */
const MARGEM_RENOVACAO_MS = 60_000;

let credencial: { token: string; expiraEm: number } | null = null;
let fonte: ChatRealtimeTokenSource | null = null;
let buscaEmAndamento: Promise<ChatRealtimeCredentials> | null = null;

export function setChatRealtimeTokenSource(source: ChatRealtimeTokenSource | null) {
  fonte = source;
}

export function storeChatRealtimeToken({ token, expiresAt }: ChatRealtimeCredentials) {
  credencial = { token, expiraEm: new Date(expiresAt).getTime() };
}

export function clearChatRealtimeToken() {
  credencial = null;
  buscaEmAndamento = null;
}

function credencialAindaValida(agora: number): ChatRealtimeCredentials | null {
  if (!credencial || !Number.isFinite(credencial.expiraEm)) return null;
  if (credencial.expiraEm - agora <= MARGEM_RENOVACAO_MS) return null;
  return {
    token: credencial.token,
    expiresAt: new Date(credencial.expiraEm).toISOString(),
  };
}

/**
 * Compartilha a credencial entre todos os canais do ERP. Chat, notificações e
 * reconexões simultâneas não precisam abrir uma Function Invocation cada um.
 */
export async function ensureChatRealtimeCredentials(
  source: ChatRealtimeTokenSource,
  agora = Date.now(),
): Promise<ChatRealtimeCredentials> {
  const emCache = credencialAindaValida(agora);
  if (emCache) return emCache;

  buscaEmAndamento ??= (async () => {
    try {
      const credenciais = await source();
      storeChatRealtimeToken(credenciais);
      return credenciais;
    } finally {
      buscaEmAndamento = null;
    }
  })();

  return buscaEmAndamento;
}

export async function chatRealtimeAccessToken(agora = Date.now()): Promise<string | null> {
  const emCache = credencialAindaValida(agora);
  if (emCache) return emCache.token;

  const source = fonte;
  if (!source) return credencial?.token ?? null;

  // Varios joins simultaneos disparam esta funcao ao mesmo tempo; uma unica
  // busca atende todos eles.
  try {
    return (await ensureChatRealtimeCredentials(source, agora)).token;
  } catch {
    return credencial?.token ?? null;
  }
}
