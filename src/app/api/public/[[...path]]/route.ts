import { publicApi } from "@/lib/imobiliario/site-api";
import { imobFailure, type ImobContext } from "@/lib/imobiliario/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: Request, context: ImobContext) {
  try { return await publicApi(request, (await context.params).path ?? []); }
  catch (error) { return imobFailure(error); }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
