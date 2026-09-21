import { after } from "next/server";
import { deliverDiagnostic } from "./erp-diagnostic-delivery";

// Pilot routes only. Never send URLs, request bodies, SQL or raw error messages.
const routes = new Set(["/api/transaction", "/api/veiculos/consulta-placa/[placa]"]);
let nextSendAt = 0;

export function reportErpDiagnostic(route: string, operation: string, startedAt: number, error: unknown) {
  if (process.env.ERP_DIAGNOSTICS_ENABLED !== "true" || !routes.has(route)) return;
  try {
    const now = Date.now();
    if (now < nextSendAt) return;
    nextSendAt = now + 60_000;
    const raw = error as { code?: unknown; name?: unknown; message?: unknown } | null;
    const code = typeof raw?.code === "string" && /^[0-9A-Z]{5}$/.test(raw.code) ? raw.code : null;
    const kind = code === "22003" || /out of range for type/i.test(String(raw?.message ?? "")) ? "NUMERIC_OVERFLOW"
      : code === "42703" ? "SCHEMA_ERROR"
      : raw?.name === "TimeoutError" || raw?.name === "AbortError" || code === "57014" ? "TIMEOUT"
      : "OPERATION_FAILED";
    const event = { requestId: crypto.randomUUID(), route, operation, code, kind, durationMs: Math.max(0, Math.min(now - startedAt, 600_000)) };
    after(async () => {
      await deliverDiagnostic(event, { url: process.env.PLATFORM_API_URL, installation: process.env.PLATFORM_INSTALLATION_ID, secret: process.env.PLATFORM_API_SECRET });
    });
  } catch { /* Even scheduling diagnostics must not alter the original response. */ }
}
