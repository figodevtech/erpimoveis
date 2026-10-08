import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

const apply = process.argv.includes("--aplicar");

async function main() {
  const configs = loadDatabaseConfigs();
  const target = configs.find((item) => item.key === "jean")!;
  const source = configs.find((item) => item.key === "demo")!;
  const lines = fs.readFileSync(path.join(projectRoot, ".env.local"), "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /Jean\s*Car/i.test(line));
  if (start < 0) throw new Error("Bloco Jean Car ausente no .env.local.");
  const values = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#\s*vari[aá]veis de ambiente/i.test(line)) break;
    const match = line.match(/^\s*(?:#\s*)?(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$/);
    if (match) values.set(match[1], match[2].replace(/^(['"])(.*)\1$/, "$2"));
  }
  const url = values.get("NEXT_PUBLIC_SUPABASE_URL");
  const key = values.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || new URL(url).hostname !== `${target.projectRef}.supabase.co`) {
    throw new Error("URL ou chave de Storage Jean Car ausente; destino deve corresponder ao projeto configurado.");
  }
  const connection = await connectDatabase(source);
  let buckets;
  try {
    buckets = (await connection.client.query<{
      id: string; name: string; public: boolean;
      file_size_limit: string | null; allowed_mime_types: string[] | null;
    }>("select id,name,public,file_size_limit,allowed_mime_types from storage.buckets order by id")).rows;
  } finally {
    await connection.client.end();
  }
  const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  const existing = await storage.listBuckets();
  if (existing.error) throw new Error(existing.error.message);
  const byId = new Map(existing.data.map((bucket) => [bucket.id, bucket]));
  for (const bucket of buckets) {
    const found = byId.get(bucket.id);
    if (bucket.name !== bucket.id) throw new Error(`Bucket ${bucket.id}: nome diferente do ID; revise antes de copiar.`);
    if (found) {
      if (found.public !== bucket.public ||
          (found.file_size_limit ?? null) !== (bucket.file_size_limit === null ? null : Number(bucket.file_size_limit)) ||
          JSON.stringify(found.allowed_mime_types ?? null) !== JSON.stringify(bucket.allowed_mime_types)) {
        throw new Error(`Bucket ${bucket.id} ja existe com configuracao diferente; nenhuma alteracao automatica nele.`);
      }
      console.log(`Ja configurado: ${bucket.id}`);
      continue;
    }
    console.log(`${apply ? "Criando" : "Criaria"}: ${bucket.id} (${bucket.public ? "publico" : "privado"})`);
    if (!apply) continue;
    const result = await storage.createBucket(bucket.id, {
      public: bucket.public,
      fileSizeLimit: bucket.file_size_limit === null ? undefined : Number(bucket.file_size_limit),
      allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
    });
    if (result.error) throw new Error(`Bucket ${bucket.id}: ${result.error.message}`);
  }
  if (!apply) {
    console.log("Conferencia concluida. Use --aplicar para criar somente no Jean Car.");
    return;
  }
  const verification = await storage.listBuckets();
  if (verification.error) throw new Error(verification.error.message);
  if (buckets.some((bucket) => !verification.data.some((item) => item.id === bucket.id))) {
    throw new Error("Verificacao encontrou bucket ausente.");
  }
  console.log(`${buckets.length} buckets conferidos no Jean Car. Nenhum arquivo foi copiado.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha ao criar buckets.");
  process.exitCode = 1;
});
