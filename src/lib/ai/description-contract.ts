import { z } from "zod";

// Contrato espelhado na Central. Chave, modelo e consumo pertencem à Central.
export const descriptionInputSchema = z.object({
  requestId: z.string().uuid(),
  produto: z.object({
    titulo: z.string().trim().min(3).max(200),
    descricao: z.string().trim().max(1000).optional(),
    fabricante: z.string().trim().max(120).optional(),
    referencia: z.string().trim().max(120).optional(),
    conservacao: z.enum(["NOVO", "USADO", "RECONDICIONADO"]).optional(),
    unidade: z.string().trim().max(20).optional(),
    grupo: z.string().trim().max(120).optional(),
  }),
});

export async function readDescriptionBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw Object.assign(new Error("invalid_body"), { statusCode: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 12000) {
      await reader.cancel();
      throw Object.assign(new Error("body_limit"), { statusCode: 413 });
    }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("invalid_json"), { statusCode: 400 }); }
}
