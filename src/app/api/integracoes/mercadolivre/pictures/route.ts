import { NextResponse } from "next/server";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { uploadMercadoLivrePictureFile, type MercadoLivreUploadedPicture } from "@/lib/integrations/mercadolivre-pictures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 10;

/**
 * Foto enviada na mídia do anúncio vai direto para o Mercado Livre: não passa
 * pelo armazenamento do ERP nem entra na galeria do produto. As fotos do produto
 * usadas no anúncio seguem pelo link que já existe.
 */
export async function POST(req: Request) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const form = await req.formData();
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length) return NextResponse.json({ error: "Envie as fotos em 'files'." }, { status: 400 });
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Máximo de ${MAX_FILES} fotos por envio.` }, { status: 400 });
    }

    const account = await getValidMercadoLivreAccount(empresaId);
    const pictures: MercadoLivreUploadedPicture[] = [];
    for (const file of files) {
      try {
        const picture = await uploadMercadoLivrePictureFile(account.access_token, file, file.name);
        if (!picture.url) throw new Error("o Mercado Livre não devolveu o endereço da foto.");
        pictures.push(picture);
      } catch (error: any) {
        return NextResponse.json(
          { error: `${file.name}: ${error?.message || "não foi possível enviá-la ao Mercado Livre."}`, pictures },
          { status: 422 },
        );
      }
    }

    return NextResponse.json({ pictures });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/pictures", e);
    return NextResponse.json({ error: e?.message || "Falha ao enviar fotos ao Mercado Livre." }, { status: errorStatus(e) });
  }
}
