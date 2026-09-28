// src/lib/auth.ts
import NextAuth, { CredentialsSignin } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  permissoesDoToken,
  VERSAO_PERMISSOES_TOKEN,
} from "@/app/api/_authz/permission-constants";
import { loadUserAccess } from "@/app/api/_authz/user-access";
import { isEmailIdentifier, normalizeLoginIdentifier } from "@/lib/auth-identifier";
import {
  buildLoginRateLimitKeys,
  credentialsHaveSafeLength,
} from "@/lib/login-security";
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  registerLoginAttempt,
  registerLoginFailure,
} from "@/lib/login-rate-limit";
import { createSupabasePasswordAuthClient } from "@/lib/supabase-password-auth";
import { isTerminalSupabaseRefreshFailure, supabaseRefreshRetryDelayMs } from "@/lib/auth-refresh-policy";
import { LoginCredentialsError } from "@/lib/auth-login-errors";

const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h

/**
 * Login e renovacao da sessao sempre leem o banco (`fresh`), numa unica consulta
 * que ja traz perfil e permissoes; o resultado fica para as checagens seguintes.
 */
function carregarUsuarioAplicacao(userId?: string | null, email?: string | null) {
  return loadUserAccess({ userId, email }, { fresh: true });
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
  token.permissoesVersao = VERSAO_PERMISSOES_TOKEN;

  return token;
}

async function renovarSessaoSupabaseSeNecessario(token: any) {
  const expiresAt = Number(token.supabaseAccessTokenExpiresAt ?? 0);
  if (token.supabaseAccessToken && expiresAt > Date.now() + 60_000) return token;
  if (!token.supabaseRefreshToken) return token;
  if (Number(token.supabaseRefreshRetryAt ?? 0) > Date.now()) return token;

  try {
    const passwordAuth = createSupabasePasswordAuthClient();
    const { data, error } = await passwordAuth.auth.refreshSession({
      refresh_token: String(token.supabaseRefreshToken),
    });
    if (error || !data.session) throw error ?? new Error("Sessao Supabase ausente");

    token.supabaseAccessToken = data.session.access_token;
    token.supabaseRefreshToken = data.session.refresh_token;
    token.supabaseAccessTokenExpiresAt = (data.session.expires_at ?? 0) * 1_000;
    token.supabaseRefreshFailures = 0;
    token.supabaseRefreshRetryAt = null;
  } catch (error) {
    console.warn("[auth] nao foi possivel renovar a sessao Supabase do Realtime:", error);
    if (isTerminalSupabaseRefreshFailure(error)) {
      token.supabaseAccessToken = null;
      token.supabaseRefreshToken = null;
      token.supabaseAccessTokenExpiresAt = null;
      token.supabaseRefreshFailures = 0;
      token.supabaseRefreshRetryAt = null;
    } else {
      const failures = Number(token.supabaseRefreshFailures ?? 0) + 1;
      token.supabaseRefreshFailures = failures;
      token.supabaseRefreshRetryAt = Date.now() + supabaseRefreshRetryDelayMs(failures);
      if (expiresAt <= Date.now()) token.supabaseAccessToken = null;
    }
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
        captchaToken: { label: "Captcha", type: "text" },
      },
      async authorize(credentials, request) {
        try {
          const identifier = normalizeLoginIdentifier(
            credentials?.identifier ?? (credentials as any)?.email
          );
          const password = String(credentials?.password ?? "");
          const captchaToken = String(credentials?.captchaToken ?? "").trim();

          if (!credentialsHaveSafeLength(identifier, password)) {
            throw new LoginCredentialsError("MISSING_CREDENTIALS");
          }

          const rateLimitKeys = buildLoginRateLimitKeys(identifier, request);
          const [identifierLimitKey, ipLimitKey, globalLimitKey] = rateLimitKeys;
          if ((await checkLoginRateLimit(rateLimitKeys)) > 0) {
            throw new LoginCredentialsError("LOGIN_RATE_LIMITED");
          }

          // Reserva a tentativa no limite global antes de consultar o Supabase.
          // As duas primeiras chaves continuam sendo registradas apenas em falhas.
          if ((await registerLoginAttempt(globalLimitKey)) > 0) {
            throw new LoginCredentialsError("LOGIN_RATE_LIMITED");
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
              throw new LoginCredentialsError("LOGIN_INTERNAL_ERROR");
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
            options: captchaToken ? { captchaToken } : undefined,
          });

          if ((error as any)?.status === 429 || (error as any)?.code === "over_request_rate_limit") {
            await registerLoginFailure([identifierLimitKey, ipLimitKey]);
            throw new LoginCredentialsError("LOGIN_RATE_LIMITED");
          }

          if ((error as any)?.code === "captcha_failed") {
            throw new LoginCredentialsError("CAPTCHA_FAILED");
          }

          if (!usernameEncontrado || error || !data?.user) {
            const retryAfter = await registerLoginFailure([identifierLimitKey, ipLimitKey]);
            if (retryAfter > 0) throw new LoginCredentialsError("LOGIN_RATE_LIMITED");
            throw new LoginCredentialsError("INVALID_CREDENTIALS");
          }

          const { user } = data;
          const usuarioAplicacao = await carregarUsuarioAplicacao(user.id, user.email);

          if (!usuarioAplicacao || !usuarioAplicacao.ativo) {
            const retryAfter = await registerLoginFailure([identifierLimitKey, ipLimitKey]);
            if (retryAfter > 0) throw new LoginCredentialsError("LOGIN_RATE_LIMITED");
            throw new LoginCredentialsError("INVALID_CREDENTIALS");
          }

          // Sucesso limpa somente o contador da conta. O contador por IP deve
          // continuar impedindo que uma conta controlada burle o throttling.
          await clearLoginRateLimit([identifierLimitKey]);

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
          if (e instanceof CredentialsSignin) throw e;

          console.error(e);
          throw new LoginCredentialsError("LOGIN_INTERNAL_ERROR");
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
        (token as any).permissoesVersao = VERSAO_PERMISSOES_TOKEN;
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
        (session.user as any).permissoes = permissoesDoToken(
          (token as any).permissoes,
          (token as any).permissoesVersao,
        );
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
