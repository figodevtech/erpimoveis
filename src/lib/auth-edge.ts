import type { NextAuthConfig } from "next-auth";
import NextAuth from "next-auth";

const MAX_AGE_SECONDS = 60 * 60 * 24;

const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [],
  session: {
    strategy: "jwt",
    maxAge: MAX_AGE_SECONDS,
  },
  jwt: {
    maxAge: MAX_AGE_SECONDS,
  },
  callbacks: {
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
};

export const { auth } = NextAuth(authConfig);
