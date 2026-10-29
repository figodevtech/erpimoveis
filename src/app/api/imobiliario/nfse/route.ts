import { invoiceCandidates, emitServiceInvoice, serviceInvoiceAction } from "@/lib/imobiliario/nfse";
import { bodyOf, imobFailure, json } from "@/lib/imobiliario/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { return json(await invoiceCandidates(new URL(request.url))); } catch (error) { return imobFailure(error); } }
export async function POST(request: Request) { try { const body = await bodyOf(request); return json(await (["CONSULTAR", "REENVIAR"].includes(String(body.acao)) ? serviceInvoiceAction(body) : emitServiceInvoice(body))); } catch (error) { return imobFailure(error); } }
