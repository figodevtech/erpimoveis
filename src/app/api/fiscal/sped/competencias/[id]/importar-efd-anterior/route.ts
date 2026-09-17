import { NextResponse } from "next/server";

import { requireSpedManage } from "@/app/api/_authz/perms";
import { importPreviousEfd, SpedServiceError } from "@/services/fiscal/sped";

import { requireSpedActor, spedErrorResponse } from "../../../_lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const form = await request.formData();
    const file = form.get("arquivo");
    if (!(file instanceof File)) {
      throw new SpedServiceError("Arquivo da EFD anterior é obrigatório.", 400, "FILE_REQUIRED");
    }
    if (!file.name.toLowerCase().endsWith(".txt")) {
      throw new SpedServiceError("A EFD anterior deve ser enviada em arquivo .txt.", 400, "INVALID_FILE_TYPE");
    }
    const { id } = await context.params;
    const result = await importPreviousEfd({
      competenceId: id,
      actorId,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json({ data: result }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return spedErrorResponse(error);
  }
}
