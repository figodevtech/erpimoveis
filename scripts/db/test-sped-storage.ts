import crypto from "node:crypto";
import { supabaseAdmin } from "../../src/lib/supabaseAdmin";

async function run() {
  console.log("Iniciando teste de ponta a ponta do Storage fiscal-sped...");

  const BUCKET = "fiscal-sped";

  // 1. Verificar se o bucket existe e se é privado
  const { data: buckets, error: bucketsError } = await supabaseAdmin.storage.listBuckets();
  if (bucketsError) {
    console.error("Erro ao listar buckets:", bucketsError);
    process.exit(1);
  }

  const spedBucket = buckets.find((b) => b.name === BUCKET);
  if (!spedBucket) {
    console.error(`Bucket '${BUCKET}' NÃO encontrado no Supabase Storage!`);
    console.log("Buckets disponíveis:", buckets.map((b) => b.name));
    process.exit(1);
  }

  console.log(`✓ Bucket '${BUCKET}' encontrado.`);
  console.log(`  Público: ${spedBucket.public} (esperado: false)`);
  if (spedBucket.public) {
    console.error("ERRO DE SEGURANÇA: O bucket fiscal-sped NÃO pode ser público!");
    process.exit(1);
  }

  // 2. Criar conteúdo de teste determinístico
  const testPayload = `|0000|020|0|01082026|31082026|TESTE STORAGE SPED|00000000000191||PB|160000000|2507507|||A|0|\r\n|9999|2|\r\n`;
  const originalBytes = Buffer.from(testPayload, "latin1");
  const originalHash = crypto.createHash("sha256").update(originalBytes).digest("hex");
  const testPath = `_test/storage-smoke-${Date.now()}-${originalHash.slice(0, 8)}.txt`;

  console.log(`\nSubindo arquivo de teste para '${testPath}'...`);
  console.log(`  Tamanho: ${originalBytes.length} bytes`);
  console.log(`  SHA-256 original: ${originalHash}`);

  // 3. Teste de upload com upsert: false
  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(testPath, originalBytes, { contentType: "text/plain", upsert: false });

  if (uploadError) {
    console.error("Erro ao fazer upload:", uploadError);
    process.exit(1);
  }
  console.log("✓ Upload concluído com sucesso:", uploadData.path);

  // 4. Teste de idempotência / rejeição de sobrescrita
  const { error: duplicateError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(testPath, originalBytes, { contentType: "text/plain", upsert: false });

  if (!duplicateError) {
    console.error("ERRO: Upload duplicado com upsert: false deveria falhar!");
    await supabaseAdmin.storage.from(BUCKET).remove([testPath]);
    process.exit(1);
  }
  console.log("✓ Idempotência confirmada: sobrescrita recusada quando upsert: false");

  // 5. Teste de download direto pelo cliente admin
  const { data: downloadData, error: downloadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(testPath);

  if (downloadError || !downloadData) {
    console.error("Erro no download direto:", downloadError);
    await supabaseAdmin.storage.from(BUCKET).remove([testPath]);
    process.exit(1);
  }

  const downloadedBytes = Buffer.from(await downloadData.arrayBuffer());
  const downloadedHash = crypto.createHash("sha256").update(downloadedBytes).digest("hex");

  if (downloadedHash !== originalHash) {
    console.error("ERRO DE INTEGRIDADE: SHA-256 do arquivo baixado diverge do original!");
    console.error("  Original :", originalHash);
    console.error("  Baixado  :", downloadedHash);
    await supabaseAdmin.storage.from(BUCKET).remove([testPath]);
    process.exit(1);
  }

  if (downloadedBytes.length !== originalBytes.length) {
    console.error("ERRO DE INTEGRIDADE: Tamanho dos bytes diverge!");
    await supabaseAdmin.storage.from(BUCKET).remove([testPath]);
    process.exit(1);
  }
  console.log("✓ Download direto validado com SHA-256 e bytes 100% idênticos.");

  // 6. Teste de URL assinada (signed URL)
  const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(testPath, 60);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error("Erro ao gerar URL assinada:", signedUrlError);
    await supabaseAdmin.storage.from(BUCKET).remove([testPath]);
    process.exit(1);
  }
  console.log("✓ URL assinada gerada com sucesso.");

  // 7. Teste de fetch HTTP via signed URL
  const httpResponse = await fetch(signedUrlData.signedUrl);
  if (!httpResponse.ok) {
    console.error(`Erro HTTP ao baixar via signed URL: ${httpResponse.status} ${httpResponse.statusText}`);
    await supabaseAdmin.storage.from(BUCKET).remove([testPath]);
    process.exit(1);
  }

  const httpBytes = Buffer.from(await httpResponse.arrayBuffer());
  const httpHash = crypto.createHash("sha256").update(httpBytes).digest("hex");

  if (httpHash !== originalHash) {
    console.error("ERRO DE INTEGRIDADE via HTTP signed URL: SHA-256 diverge!");
    await supabaseAdmin.storage.from(BUCKET).remove([testPath]);
    process.exit(1);
  }
  console.log("✓ Download via URL assinada HTTP validado com sucesso (SHA-256 idêntico).");

  // 8. Cleanup do arquivo de teste
  const { error: removeError } = await supabaseAdmin.storage.from(BUCKET).remove([testPath]);
  if (removeError) {
    console.error("Aviso ao remover arquivo de teste:", removeError);
  } else {
    console.log("✓ Limpeza (cleanup) do arquivo de teste realizada com sucesso.");
  }

  console.log("\nTODOS OS TESTES DO STORAGE fiscal-sped PASSARAM COM SUCESSO!");
}

run().catch((err) => {
  console.error("Falha inesperada no teste de storage:", err);
  process.exit(1);
});
