// src/lib/auth.ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { expandPermissions } from "@/app/api/_authz/permission-constants";
import { isEmailIdentifier, normalizeLoginIdentifier } from "@/lib/auth-identifier";
import {
  buildLoginRateLimitKeys,
  credentialsHaveSafeLength,
} from "@/lib/login-security";
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  registerLoginFailure,
} from "@/lib/login-rate-limit";
import { createSupabasePasswordAuthClient } from "@/lib/supabase-password-auth";

const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h

async function carregarPermissoesPorPerfil(perfilId: number | null): Promise<string[]> {
  if (!perfilId) return [];

  const { data, error } = await supabaseAdmin
    .from("perfilpermissao")
    .select("permissao:permissaoid ( nome )")
    .eq("perfilid", perfilId);

  if (error) {
    console.error("[auth] erro ao carregar permissoes:", error);
    return [];
  }

  return expandPermissions((data ?? []).map((r: any) => r?.permissao?.nome));
}

async function carregarUsuarioAplicacao(userId?: string | null, email?: string | null) {
  let row: any = null;

  if (userId) {
    const { data } = await supabaseAdmin
      .from("usuario")
      .select("id, email, nome, perfilid, setorid, ativo")
      .eq("id", userId)
      .maybeSingle();
    row = data ?? null;
  }

  if (!row && email) {
    const { data } = await supabaseAdmin
      .from("usuario")
      .select("id, email, nome, perfilid, setorid, ativo")
      .eq("email", email)
      .maybeSingle();
    row = data ?? null;
  }

  if (!row) return null;

  const perfilId = (row.perfilid as number | null) ?? null;

  return {
    id: row.id as string,
    email: (row.email as string | null) ?? email ?? null,
    nome: row.nome as string | null,
    perfilId,
    setorId: (row.setorid as number | null) ?? null,
    ativo: row.ativo !== false,
    permissoes: await carregarPermissoesPorPerfil(perfilId),
  };
}

async function atualizarTokenComUsuarioAtual(token: any) {
  token.permissoesRefreshedAt = Date.now();

  const usuario = await carregarUsuarioAplicacao(token.id as string | undefined, token.email as string | undefined);
  if (!usuario) return token;

  token.id = usuario.id;
  token.email = usuario.email ?? token.email;
  token.nome = usuario.nome ?? token.nome;
  token.perfilId = usuario.perfilId;
  token.setorId = usuario.setorId;
  token.ativo = usuario.ativo;
  token.permissoes = usuario.permissoes;

  return token;
}

async function renovarSessaoSupabaseSeNecessario(token: any) {
  const expiresAt = Number(token.supabaseAccessTokenExpiresAt ?? 0);
  if (token.supabaseAccessToken && expiresAt > Date.now() + 60_000) return token;
  if (!token.supabaseRefreshToken) return token;

  try {
    const passwordAuth = createSupabasePasswordAuthClient();
    const { data, error } = await passwordAuth.auth.refreshSession({
      refresh_token: String(token.supabaseRefreshToken),
    });
    if (error || !data.session) throw error ?? new Error("Sessao Supabase ausente");

    token.supabaseAccessToken = data.session.access_token;
    token.supabaseRefreshToken = data.session.refresh_token;
    token.supabaseAccessTokenExpiresAt = (data.session.expires_at ?? 0) * 1_000;
  } catch (error) {
    // A sessao principal continua valida. Somente o Realtime fica indisponivel
    // ate um novo login, sem ampliar a falha para as demais funcoes do ERP.
    console.warn("[auth] nao foi possivel renovar a sessao Supabase do Realtime:", error);
    token.supabaseAccessToken = null;
    token.supabaseRefreshToken = null;
    token.supabaseAccessTokenExpiresAt = null;
  }

  return token;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: "Credenciais",
      credentials: {
        identifier: { label: "Usuário ou e-mail", type: "text" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials, request) {
        try {
          const identifier = normalizeLoginIdentifier(
            credentials?.identifier ?? (credentials as any)?.email
          );
          const password = String(credentials?.password ?? "");

          if (!credentialsHaveSafeLength(identifier, password)) {
            throw new Error("MISSING_CREDENTIALS");
          }

          const rateLimitKeys = buildLoginRateLimitKeys(identifier, request);
          if ((await checkLoginRateLimit(rateLimitKeys)) > 0) {
            throw new Error("LOGIN_RATE_LIMITED");
          }

          let email = identifier;
          let usernameEncontrado = true;

          if (!isEmailIdentifier(identifier)) {
            const { data: usuario, error: usernameError } = await supabaseAdmin
              .from("usuario")
              .select("email")
              .eq("username", identifier)
              .maybeSingle();

            if (usernameError) {
              console.error("[auth] erro ao resolver nome de usuario:", usernameError);
              throw new Error("LOGIN_INTERNAL_ERROR");
            }

            usernameEncontrado = Boolean(usuario?.email);
            email = usernameEncontrado
              ? String(usuario!.email).trim().toLowerCase()
              : `invalid-${rateLimitKeys[0].slice(-32)}@invalid.local`;
          }

          const passwordAuth = createSupabasePasswordAuthClient();
          const { data, error } = await passwordAuth.auth.signInWithPassword({
            email,
            password,
          });

          if ((error as any)?.status === 429 || (error as any)?.code === "over_request_rate_limit") {
            throw new Error("LOGIN_RATE_LIMITED");
          }

          if (!usernameEncontrado || error || !data?.user) {
            const retryAfter = await registerLoginFailure(rateLimitKeys);
            if (retryAfter > 0) throw new Error("LOGIN_RATE_LIMITED");
            throw new Error("INVALID_CREDENTIALS");
          }

          const { user } = data;
          const usuarioAplicacao = await carregarUsuarioAplicacao(user.id, user.email);

          if (!usuarioAplicacao || !usuarioAplicacao.ativo) {
            await clearLoginRateLimit([rateLimitKeys[0]]);
            throw new Error("INVALID_CREDENTIALS");
          }

          // Sucesso limpa somente o contador da conta. O contador por IP deve
          // continuar impedindo que uma conta controlada burle o throttling.
          await clearLoginRateLimit([rateLimitKeys[0]]);

          return {
            id: usuarioAplicacao.id,
            email: usuarioAplicacao.email ?? user.email!,
            nome: usuarioAplicacao.nome ?? user.user_metadata?.nome ?? user.email ?? "Usuario",
            perfilId: usuarioAplicacao.perfilId,
            setorId: usuarioAplicacao.setorId,
            ativo: true,
            permissoes: usuarioAplicacao.permissoes,
            supabaseAccessToken: data.session?.access_token ?? null,
            supabaseRefreshToken: data.session?.refresh_token ?? null,
            supabaseAccessTokenExpiresAt: (data.session?.expires_at ?? 0) * 1_000 || null,
          } as any;
        } catch (e: any) {
          if (
            e instanceof Error &&
            ["MISSING_CREDENTIALS", "INVALID_CREDENTIALS", "LOGIN_RATE_LIMITED"].includes(e.message)
          ) {
            throw e;
          }

          console.error(e);
          throw new Error("LOGIN_INTERNAL_ERROR");
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: MAX_AGE_SECONDS,
  },

  jwt: {
    maxAge: MAX_AGE_SECONDS,
  },

  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = (user as any).id;
        token.email = (user as any).email;

        (token as any).nome = (user as any).nome;
        (token as any).perfilId = (user as any).perfilId ?? null;
        (token as any).setorId = (user as any).setorId ?? null;

        (token as any).ativo = (user as any).ativo ?? true;
        (token as any).permissoes = Array.isArray((user as any).permissoes) ? (user as any).permissoes : [];
        (token as any).permissoesRefreshedAt = Date.now();
        (token as any).supabaseAccessToken = (user as any).supabaseAccessToken ?? null;
        (token as any).supabaseRefreshToken = (user as any).supabaseRefreshToken ?? null;
        (token as any).supabaseAccessTokenExpiresAt = (user as any).supabaseAccessTokenExpiresAt ?? null;

        return token;
      }

      if (trigger === "update") {
        try {
          return await renovarSessaoSupabaseSeNecessario(await atualizarTokenComUsuarioAtual(token));
        } catch (error) {
          console.error("[auth] erro ao atualizar permissoes da sessao:", error);
          (token as any).permissoesRefreshedAt = Date.now();
        }
      }

      return renovarSessaoSupabaseSeNecessario(token);
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string;
        (session.user as any).email = token.email as string;
        (session.user as any).nome = (token as any).nome as string;
        (session.user as any).perfilId = (token as any).perfilId ?? null;
        (session.user as any).setorId = (token as any).setorId ?? null;
        (session.user as any).ativo = (token as any).ativo ?? true;
        (session.user as any).permissoes = (token as any).permissoes ?? [];
        (session.user as any).permissoesRefreshedAt = (token as any).permissoesRefreshedAt ?? null;
        (session.user as any).supabaseAccessToken = (token as any).supabaseAccessToken ?? null;
        (session.user as any).supabaseAccessTokenExpiresAt = (token as any).supabaseAccessTokenExpiresAt ?? null;
      }

      return session;
    },
  },

  pages: { signIn: "/login" },
  secret: process.env.AUTH_SECRET,
});
