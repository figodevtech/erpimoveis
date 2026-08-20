import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function checkLoginRateLimit(keys: string[]): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("auth_login_rate_limit_check", {
    p_keys: keys,
  });

  if (error) {
    console.error("[auth] falha ao consultar limite de login:", error.code);
    // Falha fechada: sem o controle de abuso disponivel, o login nao prossegue.
    return 15 * 60;
  }

  return Math.max(0, Number(data ?? 0));
}

export async function registerLoginFailure(keys: string[]): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("auth_login_rate_limit_register_failure", {
    p_keys: keys,
  });

  if (error) {
    console.error("[auth] falha ao registrar tentativa de login:", error.code);
    return 15 * 60;
  }

  return Math.max(0, Number(data ?? 0));
}

export async function clearLoginRateLimit(keys: string[]): Promise<void> {
  const { error } = await supabaseAdmin.rpc("auth_login_rate_limit_clear", {
    p_keys: keys,
  });

  if (error) console.error("[auth] falha ao limpar limite de login:", error.code);
}
