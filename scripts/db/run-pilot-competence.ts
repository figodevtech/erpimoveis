import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

// Mock 'server-only' para execução CLI fora do Next.js
const originalRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === "server-only") return {};
  return originalRequire.apply(this, arguments);
};

async function main() {
  const { supabaseAdmin } = await import("../../src/lib/supabaseAdmin");
  const {
    createSpedCompetence,
    validateSpedCompetence,
    getSpedCompetenceDetail,
  } = await import("../../src/services/fiscal/sped/competenciaService");
  const { serializeEfd } = await import("../../src/lib/sped/efd-icms-ipi/serializer");
  const { resolveSpedLayout } = await import("../../src/lib/sped/efd-icms-ipi/layout");

  console.log("=== INICIANDO EXECUÇÃO PILOTO SPED FISCAL 08/2026 ===");

  const ACTOR_ID = "34dae869-87ab-452a-bc79-d383f9c09ebc"; // Geovane (usuario Demir)

  // 1. Verificar se competência 2026-08 já existe
  const { data: existingComp, error: compErr } = await supabaseAdmin
    .from("fiscal_sped_competencia")
    .select("*")
    .eq("empresa_id", 1)
    .eq("competencia", "2026-08-01")
    .maybeSingle();

  if (compErr) {
    console.error("Erro ao buscar competência:", compErr);
    process.exit(1);
  }

  let compDetail;
  if (!existingComp) {
    console.log("Competência 08/2026 não existe. Criando...");
    compDetail = await createSpedCompetence({
      companyId: 1,
      competence: "2026-08",
      actorId: ACTOR_ID,
    });
    console.log(`✓ Competência criada com ID: ${compDetail.id}`);
  } else {
    console.log(`Competência 08/2026 já existe com ID: ${existingComp.id}`);
    compDetail = await getSpedCompetenceDetail(String(existingComp.id));
  }

  console.log(`\nCompetência ID: ${compDetail.id}, Versão: ${compDetail.versao}`);
  console.log("Executando validação e projeção da competência...");
  const validationResult = await validateSpedCompetence(
    compDetail.id,
    compDetail.versao,
    ACTOR_ID
  );

  console.log(`\nResultado da Validação:`);
  console.log(`  Status Competência: ${validationResult.data.status}`);
  console.log(`  Bloqueada para fechamento: ${validationResult.blocked}`);
  console.log(`  Versão Atual Número: ${validationResult.data.versao}`);
  console.log(`  Contagens:`, validationResult.data.contagens);
  console.log(`  Diagnósticos:`, validationResult.data.diagnosticos);

  // 2. Inspecionar Inconsistências / Diagnósticos gerados na execução atual
  const { data: execRow } = await supabaseAdmin
    .from("fiscal_sped_validacao_execucao")
    .select("id")
    .eq("competencia_id", compDetail.id)
    .order("iniciado_at", { ascending: false })
    .limit(1)
    .single();

  const execucaoId = execRow?.id;
  const { data: inconList, error: inconErr } = await supabaseAdmin
    .from("fiscal_sped_inconsistencia")
    .select("codigo, severidade, mensagem, registro_efd, campo_efd")
    .eq("execucao_id", execucaoId)
    .order("severidade")
    .order("codigo");

  if (inconErr) {
    console.error("Erro ao buscar inconsistências:", inconErr);
  } else {
    console.log(`\nInconsistências desta execução (${inconList.length} total):`);
    const porCodigo: Record<string, { count: number; severidade: string; exemplo: string }> = {};
    for (const inc of inconList) {
      if (!porCodigo[inc.codigo]) {
        porCodigo[inc.codigo] = { count: 0, severidade: inc.severidade, exemplo: inc.mensagem };
      }
      porCodigo[inc.codigo].count++;
    }
    console.log("  Resumo por Código:");
    for (const [code, info] of Object.entries(porCodigo).sort()) {
      console.log(`   - [${info.severidade}] ${code} (${info.count}x): ${info.exemplo}`);
    }
  }

  // 3. Obter ID da versão atual a partir da competência
  const { data: compRow } = await supabaseAdmin
    .from("fiscal_sped_competencia")
    .select("versao_atual_id")
    .eq("id", compDetail.id)
    .single();

  const versaoId = compRow?.versao_atual_id;
  if (!versaoId) {
    console.error("Versão atual não encontrada na competência!");
    process.exit(1);
  }

  const { data: snapData, error: snapErr } = await supabaseAdmin
    .from("fiscal_sped_cadastro_snapshot")
    .select("payload")
    .eq("versao_id", versaoId)
    .eq("tipo", "CONFIG")
    .eq("codigo", "EFD_RECORDS")
    .maybeSingle();

  if (snapErr || !snapData) {
    console.error("Erro ao buscar snapshot EFD_RECORDS:", snapErr);
    process.exit(1);
  }

  const records = (snapData.payload as any)?.records;
  console.log(`\n✓ Registros EFD projetados no snapshot: ${records?.length ?? 0}`);

  if (Array.isArray(records) && records.length > 0) {
    // 4. Serializar para TXT oficial da EFD
    const layout = resolveSpedLayout("2026-08");
    const serialized = serializeEfd(records, layout);

    console.log(`\nSerialização do TXT EFD ICMS/IPI:`);
    console.log(`  Linhas: ${serialized.lineCount}`);
    console.log(`  Tamanho: ${serialized.bytes.byteLength} bytes`);
    console.log(`  Contadores de registro:`);
    for (const [reg, count] of Object.entries(serialized.recordCounts).sort()) {
      console.log(`    ${reg}: ${count}`);
    }

    const outputPath = path.resolve(process.cwd(), "tmp_sped_demir_202608.txt");
    fs.writeFileSync(outputPath, serialized.bytes);
    console.log(`\n✓ Arquivo salvo com sucesso para homologação em: ${outputPath}`);
  }
}

main().catch((err) => {
  console.error("Falha na execução do piloto:", err);
  process.exit(1);
});
