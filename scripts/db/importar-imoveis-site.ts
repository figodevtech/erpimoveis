/**
 * Cadastra no ERP os imóveis de demonstração do site (src/data/flats.ts do
 * site-cespedesliving), com as fotos de public/images enviadas ao bucket público.
 *
 * Uso:
 *   npm run db:importar:imoveis-site -- --email <operador> --proprietario <id>
 *   npm run db:importar:imoveis-site -- --email <operador> --proprietario <id> --aplicar [--publicar]
 *
 * Sem `--aplicar` só confere dados e fotos. É idempotente pelo slug: imóvel já
 * cadastrado é ignorado. Segue o fluxo da tela: grava sem publicar, envia as
 * fotos e só então publica, para valer a mesma regra de publicação do ERP.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { imovelSchema } from "../../src/lib/imobiliario/schemas";
import { IMOBILIARIO_BUCKET_FOTOS } from "../../src/lib/imobiliario/types";
import { parseSimpleEnv, projectRoot } from "./lib";

type SiteFlat = {
  id: string; slug: string; title: string; neighborhood: string; city: string; state: string; description: string;
  gallery: string[]; realPhotos?: boolean; maxGuests: number; bedrooms: number; bathrooms: number; areaSqm: number;
  amenities: string[]; active: boolean; published: boolean; fromPrice: number; tag: string;
};

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const APLICAR = args.includes("--aplicar");
const PUBLICAR = args.includes("--publicar");
const siteDir = path.resolve(arg("--site") ?? path.join(projectRoot, "..", "site-cespedesliving"));

function isWebp(bytes: Buffer) { return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"; }

async function main() {
  const email = arg("--email")?.trim().toLowerCase(); const ownerId = Number(arg("--proprietario"));
  if (!email || !Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error("Informe --email do operador e --proprietario <id>.");
  const env = parseSimpleEnv(path.join(projectRoot, ".env.local"));
  const url = env.get("NEXT_PUBLIC_SUPABASE_URL"); const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local.");
  if (new URL(url).hostname !== "hchntifztkbopchpvstd.supabase.co") throw new Error("Este script só grava no banco da Cespedes Living.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const operator = await db.from("usuario").select("id,ativo").ilike("email", email).maybeSingle();
  if (operator.error) throw operator.error;
  if (!operator.data?.ativo) throw new Error("Operador não encontrado ou inativo no ERP.");
  const owner = await db.from("proprietario").select("id,nomerazaosocial,ativo,percentual_admin").eq("id", ownerId).maybeSingle();
  if (owner.error) throw owner.error;
  if (!owner.data?.ativo) throw new Error("Proprietário não encontrado ou inativo.");

  const { mockFlats } = await import(pathToFileURL(path.join(siteDir, "src/data/flats.ts")).href) as { mockFlats: SiteFlat[] };
  console.log(`${mockFlats.length} imóveis no site · proprietário: ${owner.data.nomerazaosocial} · ${APLICAR ? (PUBLICAR ? "aplicar e publicar" : "aplicar sem publicar") : "simulação"}\n`);

  for (const flat of mockFlats) {
    const existing = await db.from("imovel").select("id").eq("slug", flat.slug).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) { console.log(`= ${flat.title}: já cadastrado (#${existing.data.id}), ignorado.`); continue; }

    const photos = flat.gallery.map((src) => {
      const file = path.join(siteDir, "public", src);
      const bytes = fs.readFileSync(file);
      if (!isWebp(bytes) || bytes.length > 10 * 1024 * 1024) throw new Error(`${src}: a foto deve ser WebP de até 10 MB.`);
      return { src, bytes };
    });
    const address = { bairro: flat.neighborhood, cidade: flat.city, estado: flat.state };
    // Passa pelo schema da tela para o imóvel ficar editável no ERP sem ajustes.
    const row = imovelSchema.parse({
      proprietario_id: ownerId, codigo: flat.id.toUpperCase(), titulo: flat.title, slug: flat.slug, tipo: "FLAT",
      descricao: flat.description, modalidades: ["TEMPORADA"], ativo: flat.active, publicado: false,
      selo_anuncio: flat.tag, fotos_reais: Boolean(flat.realPhotos), endereco: address, endereco_publico: address,
      comodidades: flat.amenities, capacidade: flat.maxGuests, quartos: flat.bedrooms, banheiros: flat.bathrooms,
      area: flat.areaSqm, diaria: flat.fromPrice, percentual_admin: Number(owner.data.percentual_admin ?? 0),
    });
    const summary = `${flat.title}: ${photos.length} fotos, R$ ${flat.fromPrice}/noite, até ${flat.maxGuests} hóspedes${flat.realPhotos ? ", fotos reais" : ""}`;
    if (!APLICAR) { console.log(`+ ${summary}`); continue; }

    const created = await db.from("imovel").insert({ ...row, created_by: operator.data.id }).select("id").single();
    if (created.error) throw created.error;
    const imovelId = created.data.id as number; const uploaded: string[] = [];
    try {
      for (const [ordem, photo] of photos.entries()) {
        const storagePath = `imoveis/${imovelId}/${randomUUID()}.webp`;
        const upload = await db.storage.from(IMOBILIARIO_BUCKET_FOTOS).upload(storagePath, photo.bytes, { contentType: "image/webp", upsert: false });
        if (upload.error) throw upload.error;
        uploaded.push(storagePath);
        const file = await db.from("imovel_arquivo").insert({ imovel_id: imovelId, bucket: IMOBILIARIO_BUCKET_FOTOS, path: storagePath, tipo: "FOTO",
          nome: path.basename(photo.src), mime: "image/webp", tamanho: photo.bytes.length, publico: true, ordem, created_by: operator.data.id });
        if (file.error) throw file.error;
      }
      if (PUBLICAR && flat.published) {
        const published = await db.from("imovel").update({ publicado: true, updated_by: operator.data.id }).eq("id", imovelId);
        if (published.error) throw published.error;
      }
    } catch (error) {
      // Imóvel recém-criado e sem operações: desfaz arquivos e cadastro para permitir nova execução.
      if (uploaded.length) await db.storage.from(IMOBILIARIO_BUCKET_FOTOS).remove(uploaded);
      await db.from("imovel_arquivo").delete().eq("imovel_id", imovelId);
      await db.from("imovel").delete().eq("id", imovelId);
      throw error;
    }
    console.log(`+ ${summary} → #${imovelId}${PUBLICAR && flat.published ? ", publicado" : ""}`);
  }
  if (!APLICAR) console.log("\nSimulação — nada foi gravado. Repita com --aplicar.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
