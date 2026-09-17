import Module from "node:module";

// Mock 'server-only' para execução CLI
const originalRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === "server-only") return {};
  return originalRequire.apply(this, arguments);
};

async function main() {
  const { supabaseAdmin } = await import("../../src/lib/supabaseAdmin");

  const { data: comp } = await supabaseAdmin
    .from("fiscal_sped_competencia")
    .select("id, competencia, status, versao_atual_id")
    .eq("empresa_id", 1)
    .maybeSingle();

  console.log("Competência:", comp);

  const { data: execs, error: execErr } = await supabaseAdmin
    .from("fiscal_sped_validacao_execucao")
    .select("*")
    .order("iniciado_at", { ascending: false });

  console.log("Execuções encontradas:", execs?.length, "Erro:", execErr);
  if (execs && execs.length > 0) {
    console.log("Primeira execução:", execs[0]);
  }
  const execRow = execs?.[0];

  const { data: incs, error } = await supabaseAdmin
    .from("fiscal_sped_inconsistencia")
    .select("codigo, severidade, mensagem, registro_efd, campo_efd")
    .eq("execucao_id", execRow?.id ?? 0);

  if (error) {
    console.error("Erro:", error);
    return;
  }

  console.log("Total registros na tabela:", incs?.length);

  const counts: Record<string, { count: number; severidade: string; msg: string; registro: string; campo: string }> = {};
  for (const inc of incs ?? []) {
    if (!counts[inc.codigo]) {
      counts[inc.codigo] = { count: 0, severidade: inc.severidade, msg: inc.mensagem, registro: inc.registro_efd, campo: inc.campo_efd };
    }
    counts[inc.codigo].count++;
  }

  console.log("\nDetalhamento por código:");
  let soma = 0;
  for (const [code, info] of Object.entries(counts).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))) {
    console.log(`  ${code}: ${info.count}x [${info.severidade}] (${info.registro ?? ""} ${info.campo ?? ""}) -> "${info.msg}"`);
    soma += info.count;
  }
  console.log("\nSoma total:", soma);
}

main().catch(console.error);
