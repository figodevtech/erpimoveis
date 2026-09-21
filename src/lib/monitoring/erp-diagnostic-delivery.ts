export async function deliverDiagnostic(event: unknown, config: { url?: string; installation?: string; secret?: string }, request = fetch) {
  try {
    const url = new URL("/api/v1/diagnostics/events", config.url);
    if (url.protocol !== "https:" || !config.installation || !config.secret) return false;
    const response = await request(url, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(2000),
      headers: { "Content-Type": "application/json", "X-Installation-Id": config.installation, Authorization: `Bearer ${config.secret}` },
      body: JSON.stringify(event) });
    return response.ok;
  } catch { return false; }
}
