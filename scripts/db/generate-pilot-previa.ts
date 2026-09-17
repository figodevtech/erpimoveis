import Module from "node:module";

// Mock 'server-only' para execução CLI fora do Next.js
const originalRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === "server-only") return {};
  return originalRequire.apply(this, arguments);
};

async function main() {
  const { supabaseAdmin } = await import("../../src/lib/supabaseAdmin");
  const { generateSpedFile, getSpedCompetenceDetail } = await import(
    "../../src/services/fiscal/sped/competenciaService"
  );

  console.log("=== GERANDO PRÉVIA SPED FISCAL 08/2026 DEMIR DIESEL ===");
  const ACTOR_ID = "34dae869-87ab-452a-bc79-d383f9c09ebc"; // Geovane (usuario Demir)

  const detailBefore = await getSpedCompetenceDetail("1");
  console.log(`Competência: ${detailBefore.competencia}, Versão: ${detailBefore.versao}, Status: ${detailBefore.status}`);

  console.log("\nExecutando generateSpedFile com tipo 'PREVIA'...");
  const detailAfter = await generateSpedFile("1", detailBefore.versao, ACTOR_ID, { tipo: "PREVIA" });

  console.log("\n✓ Prévia gerada com sucesso!");
  console.log("Arquivos na competência:");
  for (const arq of detailAfter.arquivos) {
    console.log(`  - [ID: ${arq.id}] Sequência ${arq.sequencia} | Tipo: ${arq.tipo} | Tamanho: ${arq.tamanhoBytes} bytes | Registros: ${arq.quantidadeRegistros} | SHA-256: ${arq.arquivoSha256}`);
  }

  // Verificar arquivo no banco pelo ID do primeiro arquivo retornado
  const fileId = detailAfter.arquivos[0]?.id;
  const { data: dbFile, error: dbErr } = await supabaseAdmin
    .from("fiscal_sped_arquivo")
    .select("*")
    .eq("id", fileId)
    .single();

  if (dbErr) {
    console.error("Erro ao buscar no banco:", dbErr);
  } else {
    console.log("\nRegistro no banco fiscal_sped_arquivo:", {
      id: dbFile.id,
      sequencia: dbFile.sequencia,
      tipo: dbFile.tipo,
      storage_path: dbFile.storage_path,
      arquivo_sha256: dbFile.arquivo_sha256,
      quantidade_registros: dbFile.quantidade_registros,
    });
  }

  // Verificar se download via Storage funciona
  const { data: downloadData, error: downloadErr } = await supabaseAdmin.storage
    .from("fiscal-sped")
    .download(dbFile.storage_path);

  if (downloadErr) {
    console.error("Erro ao baixar do Storage:", downloadErr);
  } else {
    const bytes = Buffer.from(await downloadData.arrayBuffer());
    console.log(`✓ Download do Storage confirmado: ${bytes.length} bytes recebidos com sucesso!`);
  }
}

main().catch((err) => {
  console.error("Falha ao gerar prévia:", err);
  process.exit(1);
});
