import { supabaseAdmin } from "@/lib/supabaseAdmin";

const LOGO_EXTENSIONS = /\.(avif|webp|png|jpe?g|gif|svg)$/i;
const LOGO_DIR = "images/logo";

/**
 * Teto para embutir a logo na folha. Acima disso o custo de inflar todo o HTML
 * supera o ganho, e a URL remota volta a ser a melhor opção.
 */
const LOGO_MAX_INLINE_BYTES = 1_500_000;

const MIME_POR_EXTENSAO: Record<string, string> = {
  avif: "image/avif",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

function mimePorNome(nome: string) {
  const extensao = nome.split(".").pop()?.toLowerCase() ?? "";
  return MIME_POR_EXTENSAO[extensao] ?? "image/png";
}

async function encontrarPrimeiroLogo() {
  const { data, error } = await supabaseAdmin.storage
    .from("empresa")
    .list(LOGO_DIR, {
      limit: 100,
      sortBy: { column: "name", order: "asc" },
    });

  if (error) {
    console.error("Erro ao listar logos da empresa no Supabase:", error);
    return null;
  }

  const logo = (data ?? []).find((file) => {
    const name = String(file.name ?? "").trim();
    return LOGO_EXTENSIONS.test(name);
  });

  return logo?.name ?? null;
}

function urlPublicaDoLogo(nome: string) {
  const { data } = supabaseAdmin.storage
    .from("empresa")
    .getPublicUrl(`${LOGO_DIR}/${nome}`);

  return data.publicUrl || null;
}

export async function fetchPrimeiroLogoEmpresa() {
  const nome = await encontrarPrimeiroLogo();
  if (!nome) return null;

  return urlPublicaDoLogo(nome);
}

/**
 * Logo já embutida como data URL, para as folhas de impressão.
 *
 * Na exportação em imagem o html-to-image precisa converter cada `img` remota
 * em data URL, e faz isso com um fetch no navegador. Qualquer falha ali — CORS,
 * rede instável no celular — é engolida: a lib troca o src por string vazia,
 * registra um console.warn e segue. Pior, ela guarda o resultado vazio em cache
 * por URL, então a logo some de todas as exportações seguintes até recarregar
 * a página. Entregando a imagem já embutida, não existe fetch para falhar.
 */
export async function fetchLogoEmpresaDataUrl() {
  const nome = await encontrarPrimeiroLogo();
  if (!nome) return null;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from("empresa")
      .download(`${LOGO_DIR}/${nome}`);

    if (error || !data) throw error ?? new Error("Download vazio.");

    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.byteLength > LOGO_MAX_INLINE_BYTES) return urlPublicaDoLogo(nome);

    const mime = data.type || mimePorNome(nome);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch (error) {
    // A folha com logo remota ainda imprime; sem logo nenhuma, não.
    console.error("Erro ao embutir a logo da empresa:", error);
    return urlPublicaDoLogo(nome);
  }
}
