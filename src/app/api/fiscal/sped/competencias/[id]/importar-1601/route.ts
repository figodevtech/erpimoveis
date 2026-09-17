import { NextResponse } from "next/server";

import { requireSpedManage } from "@/app/api/_authz/perms";
import { import1601Csv, SpedServiceError } from "@/services/fiscal/sped";

import { requireSpedActor, spedErrorResponse } from "../../../_lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSpedManage();
    const actorId = await requireSpedActor();
    const form = await request.formData();
    const file = form.get("arquivo");
    if (!(file instanceof File)) {
      throw new SpedServiceError("CSV do registro 1601 é obrigatório.", 400, "FILE_REQUIRED");
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      throw new SpedServiceError("O registro 1601 deve ser enviado em arquivo .csv.", 400, "INVALID_FILE_TYPE");
    }
    const { id } = await context.params;
    const result = await import1601Csv({
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
