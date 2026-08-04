// src/lib/auth.ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { expandPermissions } from "@/app/api/_authz/permission-constants";

const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h
const PERMISSIONS_TOKEN_REFRESH_INTERVAL_MS = 5 * 1000;

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

async function carregarPermissoesDaSessao(token: any) {
  const usuario = await carregarUsuarioAplicacao(token.id as string | undefined, token.email as string | undefined);
  if (!usuario) {
    return {
      id: token.id as string | undefined,
      email: token.email as string | undefined,
      nome: token.nome as string | undefined,
      perfilId: (token as any).perfilId ?? null,
      setorId: (token as any).setorId ?? null,
      ativo: (token as any).ativo ?? true,
      permissoes: (token as any).permissoes ?? [],
      permissoesRefreshedAt: (token as any).permissoesRefreshedAt ?? null,
    };
  }

  return {
    ...usuario,
    permissoesRefreshedAt: Date.now(),
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: "Credenciais",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            throw new Error("MISSING_CREDENTIALS");
          }

          const { data, error } = await supabase.auth.signInWithPassword({
            email: String(credentials.email),
            password: String(credentials.password),
          });

          if (error || !data?.user) {
            throw new Error("INVALID_CREDENTIALS");
          }

          const { user } = data;
          const usuarioAplicacao = await carregarUsuarioAplicacao(user.id, user.email);
          const ativo = usuarioAplicacao?.ativo ?? true;

          if (!ativo) {
            throw new Error("USER_BLOCKED");
          }

          return {
            id: usuarioAplicacao?.id ?? user.id,
            email: usuarioAplicacao?.email ?? user.email!,
            nome: usuarioAplicacao?.nome ?? user.user_metadata?.nome ?? user.email ?? "Usuario",
            perfilId: usuarioAplicacao?.perfilId ?? null,
            setorId: usuarioAplicacao?.setorId ?? null,
            ativo,
            permissoes: usuarioAplicacao?.permissoes ?? [],
          } as any;
        } catch (e: any) {
          if (
            e instanceof Error &&
            ["MISSING_CREDENTIALS", "INVALID_CREDENTIALS", "USER_BLOCKED"].includes(e.message)
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

        return token;
      }

      const lastRefresh = Number((token as any).permissoesRefreshedAt ?? 0);
      const shouldRefresh = trigger === "update" || Date.now() - lastRefresh > PERMISSIONS_TOKEN_REFRESH_INTERVAL_MS;

      if (shouldRefresh) {
        try {
          return await atualizarTokenComUsuarioAtual(token);
        } catch (error) {
          console.error("[auth] erro ao atualizar permissoes da sessao:", error);
          (token as any).permissoesRefreshedAt = Date.now();
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        const usuarioAtual = await carregarPermissoesDaSessao(token);

        (session.user as any).id = usuarioAtual.id as string;
        (session.user as any).email = usuarioAtual.email as string;

        (session.user as any).nome = usuarioAtual.nome as string;
        (session.user as any).perfilId = usuarioAtual.perfilId ?? null;
        (session.user as any).setorId = usuarioAtual.setorId ?? null;

        (session.user as any).ativo = usuarioAtual.ativo ?? true;
        (session.user as any).permissoes = usuarioAtual.permissoes ?? [];
        (session.user as any).permissoesRefreshedAt = usuarioAtual.permissoesRefreshedAt ?? null;
      }

      return session;
    },
  },

  pages: { signIn: "/login" },
  secret: process.env.AUTH_SECRET,
});
