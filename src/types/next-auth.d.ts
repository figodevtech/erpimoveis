// src/types/next-auth.d.ts
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      nome?: string | null;
      perfilId?: number | null;
      setorId?: number | null;
      ativo?: boolean;
      permissoes?: string[];
      permissoesRefreshedAt?: number | null;
      supabaseAccessToken?: string | null;
      supabaseAccessTokenExpiresAt?: number | null;
    };
  }

  interface User {
    id: string;
    email?: string | null;
    image?: string | null;
    nome?: string | null;
    perfilId?: number | null;
    setorId?: number | null;
    ativo?: boolean;
    permissoes?: string[];
    supabaseAccessToken?: string | null;
    supabaseRefreshToken?: string | null;
    supabaseAccessTokenExpiresAt?: number | null;
    supabaseRefreshFailures?: number | null;
    supabaseRefreshRetryAt?: number | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    email?: string | null;
    nome?: string | null;
    perfilId?: number | null;
    setorId?: number | null;
    ativo?: boolean;
    permissoes?: string[];
    permissoesRefreshedAt?: number | null;
    /** Ausente em token emitido antes de VERSAO_PERMISSOES_TOKEN. */
    permissoesVersao?: number | null;
    supabaseAccessToken?: string | null;
    supabaseRefreshToken?: string | null;
    supabaseAccessTokenExpiresAt?: number | null;
    supabaseRefreshFailures?: number | null;
    supabaseRefreshRetryAt?: number | null;
  }
}
