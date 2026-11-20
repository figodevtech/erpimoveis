import { servicosResource } from "@/lib/imobiliario/servicos";
import { imobFailure, type ImobContext } from "@/lib/imobiliario/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sem regra no middleware: a lista pede a Execução, e as ações também servem à aba Serviços do
// imóvel (quem edita imóveis). A rota decide o que cada um pode.
async function handler(request: Request, context: ImobContext) {
  try { return await servicosResource(request, (await context.params).path ?? []); }
  catch (error) { return imobFailure(error); }
}
export { handler as GET, handler as POST };
