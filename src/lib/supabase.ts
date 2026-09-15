// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!url || !anon) {
  throw new Error("[supabase] defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local");
}

// Reutiliza a instancia no navegador inclusive durante o Fast Refresh.
// No servidor, nao compartilha sessoes entre requisicoes por meio de globalThis.
const browserGlobal = globalThis as typeof globalThis & {
  __erpSupabaseAuth?: { url: string; anon: string; client: ReturnType<typeof createClient> };
};
const cached = typeof window !== "undefined" ? browserGlobal.__erpSupabaseAuth : undefined;
export const supabase = cached?.url === url && cached.anon === anon
  ? cached.client
  : createClient(url, anon);

if (typeof window !== "undefined") {
  browserGlobal.__erpSupabaseAuth = { url, anon, client: supabase };
}
