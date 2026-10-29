import { after } from "next/server";
import { deliverDiagnostic } from "./erp-diagnostic-delivery";
import { databaseErrorDetail } from "./database-error-detail";

// Pilot routes only. Never send URLs, request bodies, SQL or raw error messages.
const routes = new Set(["/api/transaction"]);
let nextSendAt = 0;

export function reportErpDiagnostic(route: string, operation: string, startedAt: number, error: unknown, stage?: "QUERY_TRANSACTIONS") {
  if (process.env.ERP_DIAGNOSTICS_ENABLED !== "true" || !routes.has(route)) return;
  try {
    const now = Date.now();
    if (now < nextSendAt) return;
    nextSendAt = now + 60_000;
    const raw = error as { code?: unknown; name?: unknown; message?: unknown } | null;
    const code = typeof raw?.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(raw.code) ? raw.code : null;
    const kind = code === "22003" || /out of range for type/i.test(String(raw?.message ?? "")) ? "NUMERIC_OVERFLOW"
      : code === "42703" || code === "42P01" || code === "PGRST204" ? "SCHEMA_ERROR"
      : raw?.name === "TimeoutError" || raw?.name === "AbortError" || code === "57014" ? "TIMEOUT"
      : "OPERATION_FAILED";
    const revision = process.env.VERCEL_GIT_COMMIT_SHA;
    const event = { requestId: crypto.randomUUID(), route, operation, code, kind,
      stage, database: stage === "QUERY_TRANSACTIONS" ? databaseErrorDetail(error) : undefined,
      revision: revision && /^[a-f0-9]{40}$/i.test(revision) ? revision : undefined,
      durationMs: Math.max(0, Math.min(now - startedAt, 600_000)) };
    after(async () => {
      await deliverDiagnostic(event, { url: process.env.PLATFORM_API_URL, installation: process.env.PLATFORM_INSTALLATION_ID, secret: process.env.PLATFORM_API_SECRET });
    });
  } catch { /* Even scheduling diagnostics must not alter the original response. */ }
}
