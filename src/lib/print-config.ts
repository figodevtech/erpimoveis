import { supabaseAdmin } from "@/lib/supabaseAdmin";

const DEFAULT_PRINT_COLORS = {
  primary: "#2563eb",
  secondary: "#0891b2",
  text: "#ffffff",
};

const PRINT_COLORS_SELECT = "impressao_cor_primaria, impressao_cor_secundaria, impressao_cor_texto";
const PRINT_COLORS_SELECT_SEM_TEXTO = "impressao_cor_primaria, impressao_cor_secundaria";

function normalizeHexColor(value: unknown, fallback: string) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function colunaNaoExiste(error: { code?: string } | null) {
  return error?.code === "42703";
}

function buscarLinha(select: string) {
  return supabaseAdmin
    .from("config_geral")
    .select(select)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function fetchPrintColors() {
  let { data, error } = await buscarLinha(PRINT_COLORS_SELECT);

  // Antes da migração da cor de texto, as duas cores antigas ainda devem valer.
  if (error && colunaNaoExiste(error)) {
    ({ data, error } = await buscarLinha(PRINT_COLORS_SELECT_SEM_TEXTO));
  }

  if (error) {
    console.error("Erro ao buscar cores de impressao:", error);
    return DEFAULT_PRINT_COLORS;
  }

  const config = data as Record<string, unknown> | null;

  return {
    primary: normalizeHexColor(config?.impressao_cor_primaria, DEFAULT_PRINT_COLORS.primary),
    secondary: normalizeHexColor(config?.impressao_cor_secundaria, DEFAULT_PRINT_COLORS.secondary),
    text: normalizeHexColor(config?.impressao_cor_texto, DEFAULT_PRINT_COLORS.text),
  };
}
