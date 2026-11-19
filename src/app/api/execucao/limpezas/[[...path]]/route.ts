import { limpezasResource } from "@/lib/imobiliario/limpezas";
import { imobFailure, type ImobContext } from "@/lib/imobiliario/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sem regra no middleware: qualquer usuário ativo entra e a rota decide o que ele vê.
async function handler(request: Request, context: ImobContext) {
  try { return await limpezasResource(request, (await context.params).path ?? []); }
  catch (error) { return imobFailure(error); }
}
export { handler as GET, handler as POST };
