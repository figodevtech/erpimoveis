import { customerSiteAccess } from "@/lib/imobiliario/internal-api";
import { identifier, imobFailure } from "@/lib/imobiliario/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await customerSiteAccess(request, identifier((await context.params).id)); }
  catch (error) { return imobFailure(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await customerSiteAccess(request, identifier((await context.params).id)); }
  catch (error) { return imobFailure(error); }
}
