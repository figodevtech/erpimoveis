// app/api/_authz/user-access.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createTtlCache } from "@/lib/ttl-cache";
import { expandPermissions } from "./permission-constants";

export type UserAccess = {
  id: string;
  email: string | null;
  nome: string | null;
  perfilId: number | null;
  setorId: number | null;
  ativo: boolean;
  permissoes: string[];
};

/**
 * Usuario, perfil e permissoes numa unica leitura do PostgREST. Antes eram duas
 * (`usuario` e `perfilpermissao`) a cada `hasPerm`/`require*`, repetidas quantas
 * vezes a rota checasse.
 */
const USER_ACCESS_SELECT =
  "id, email, nome, perfilid, setorid, ativo, perfil:perfilid(perfilpermissao(permissao:permissaoid(nome)))";

/**
 * O mesmo limite que o middleware ja aceita para desativacao. O cache e so uma
 * otimizacao desta instancia: vencido ou vazio, a decisao volta a sair do banco.
 */
const USER_ACCESS_TTL_MS = 15_000;

const cache = createTtlCache<string, UserAccess | null>({ ttlMs: USER_ACCESS_TTL_MS });

function umOuPrimeiro(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

function permissoesDoPerfil(perfil: unknown): string[] {
  const vinculos = umOuPrimeiro(perfil)?.perfilpermissao;
  if (!Array.isArray(vinculos)) return [];
  return expandPermissions(vinculos.map((vinculo) => umOuPrimeiro(vinculo?.permissao)?.nome));
}

function paraAcesso(row: Record<string, any>, emailInformado: string | null): UserAccess {
  const perfilId = row.perfilid == null ? null : Number(row.perfilid);
  const ativo = row.ativo !== false;
  return {
    id: String(row.id),
    email: (row.email as string | null) ?? emailInformado,
    nome: (row.nome as string | null) ?? null,
    perfilId,
    setorId: row.setorid == null ? null : Number(row.setorid),
    ativo,
    // Usuario desativado nao carrega permissao nenhuma, mesmo que o perfil tenha.
    permissoes: ativo && perfilId ? permissoesDoPerfil(row.perfil) : [],
  };
}

async function buscarPor(coluna: "id" | "email", valor: string) {
  const { data, error } = await supabaseAdmin
    .from("usuario")
    .select(USER_ACCESS_SELECT)
    .eq(coluna, valor)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, any> | null) ?? null;
}

async function lerDoBanco(userId: string | null, email: string | null): Promise<UserAccess | null> {
  let row = userId ? await buscarPor("id", userId) : null;
  if (!row && email) row = await buscarPor("email", email);
  return row ? paraAcesso(row, email) : null;
}

/**
 * Le o acesso atual do usuario. `fresh` ignora o cache (login e renovacao da
 * sessao), mas grava o resultado para as checagens seguintes.
 */
export function loadUserAccess(
  { userId, email }: { userId?: string | null; email?: string | null },
  options?: { fresh?: boolean },
): Promise<UserAccess | null> {
  const id = userId?.trim() || null;
  const mail = email?.trim() || null;
  if (!id && !mail) return Promise.resolve(null);

  const key = id ? `id:${id}` : `email:${mail!.toLowerCase()}`;
  return cache.get(key, () => lerDoBanco(id, mail), options);
}

/**
 * Descarta o que esta instancia guardou. Sem argumento, limpa tudo (mudanca de
 * perfil atinge varios usuarios). As outras instancias vencem pelo TTL.
 */
export function invalidateUserAccess(userId?: string | null) {
  if (userId) cache.invalidate(`id:${userId}`);
  else cache.clear();
}
