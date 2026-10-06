import { supabaseAdmin } from "@/lib/supabaseAdmin";

/** Nomes de quem criou, para as linhas manuais dizerem de onde vieram. */
export async function comCriadoPor(eventos: any[]) {
  const usuarioIds = Array.from(new Set(
    eventos
      .map((evento: any) => String(evento.created_by ?? "").trim())
      .filter(Boolean),
  ));
  if (usuarioIds.length === 0) return eventos.map((evento) => ({ ...evento, criado_por: null }));

  const { data, error } = await supabaseAdmin
    .from("usuario")
    .select("id, nome, email")
    .in("id", usuarioIds);
  if (error) throw error;

  const porId = new Map(
    (data ?? []).map((usuario: any) => [String(usuario.id), {
      id: String(usuario.id),
      nome: String(usuario.nome || usuario.email || "Usuário"),
    }]),
  );
  return eventos.map((evento: any) => ({
    ...evento,
    criado_por: evento.created_by
      ? porId.get(String(evento.created_by)) ?? { id: String(evento.created_by), nome: "Usuário não identificado" }
      : null,
  }));
}



