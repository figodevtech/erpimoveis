export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { emitirEnvioDireto, lerArquivoDeclarado } from "@/lib/anexos/envio-direto";
import {
  BUCKET,
  ensureBucket,
  exigirVagaNaOs,
  MAX_FILE_SIZE,
  parseId,
  prefixoDaOs,
  respostaDeErro,
  type Params,
} from "../_lib/anexos";

/** Etapa 1 do envio direto: valida e devolve a URL assinada de upload. */
export async function POST(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const osId = await parseId(context);
    await exigirVagaNaOs(osId);

    const arquivo = lerArquivoDeclarado(await req.json().catch(() => null));
    if (arquivo.tipo !== "application/pdf" && !arquivo.tipo.startsWith("image/")) {
      return NextResponse.json({ error: "Tipo de arquivo invalido. Envie imagem ou PDF." }, { status: 400 });
    }
    if (arquivo.tamanho > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Arquivo muito grande. Maximo: 10MB." }, { status: 400 });
    }

    await ensureBucket();
    return NextResponse.json(await emitirEnvioDireto(BUCKET, prefixoDaOs(osId), arquivo));
  } catch (error: any) {
    console.error("POST /api/ordens/[id]/anexos/envio", error);
    return respostaDeErro(error, "Erro ao preparar o envio do anexo.");
  }
}
